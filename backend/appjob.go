package main

// 设备阶段的小应用生成。APK 里的 WebView 到不了 HTTP 服务，桥进程又有
// 12 秒的请求上限，生成（实测一版约 30 分钟）不能跑在桥的请求循环里。
// 桥只负责受理：校验、去重、占当日名额、写一行 app_jobs、拉起独立的
// app-job 进程（密钥走 stdin，不进 argv）。生成在独立进程里跑，35 分钟
// 预算，结果直接落库；页面用轻量的 artifacts 操作轮询。
//
// 失败语义与 HTTP 一致：pending 消失就是失败信号。任务行由 worker 在
// 结束时删除；worker 被系统杀掉时，下一次受理或轮询按 PID 与 35 分钟
// 上限清理，pending 同样消失。重做失败时旧卡原样还在。

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const appJobSchema = `
CREATE TABLE IF NOT EXISTS app_jobs (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	date TEXT NOT NULL,
	request TEXT NOT NULL,
	update_id TEXT NOT NULL DEFAULT '',
	endpoint TEXT NOT NULL,
	model TEXT NOT NULL,
	seq INTEGER NOT NULL DEFAULT 0,
	started_at TEXT NOT NULL,
	pid INTEGER NOT NULL DEFAULT 0
);`

const (
	appJobBudget   = 35 * time.Minute
	appJobLogLimit = 256 << 10
	// 受理后超过这个时间还没登记 PID，视为受理方死在半路。
	appJobPIDGrace = 2 * time.Minute
)

const appJobColumns = "id,user_id,date,request,update_id,endpoint,model,seq,started_at,pid"

type appJobRow struct {
	ID       string
	User     string
	Date     string
	Request  string
	UpdateID string
	Endpoint string
	Model    string
	Seq      int
	Started  time.Time
	PID      int
}

func (s *Store) insertAppJob(j appJobRow) error {
	return s.write(func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO app_jobs(`+appJobColumns+`) VALUES(?,?,?,?,?,?,?,?,?,?)`,
			j.ID, j.User, j.Date, j.Request, j.UpdateID, j.Endpoint, j.Model, j.Seq,
			j.Started.UTC().Format(time.RFC3339), j.PID)
		return err
	})
}

func scanAppJob(row rowScanner) (appJobRow, error) {
	var j appJobRow
	var started string
	err := row.Scan(&j.ID, &j.User, &j.Date, &j.Request, &j.UpdateID, &j.Endpoint, &j.Model, &j.Seq, &started, &j.PID)
	if err == nil {
		j.Started, _ = time.Parse(time.RFC3339, started)
	}
	return j, err
}

func (s *Store) appJob(id string) (appJobRow, bool, error) {
	j, err := scanAppJob(s.db.QueryRow(`SELECT `+appJobColumns+` FROM app_jobs WHERE id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return appJobRow{}, false, nil
	}
	if err != nil {
		return appJobRow{}, false, err
	}
	return j, true, nil
}

func (s *Store) appJobRows(user, date string) ([]appJobRow, error) {
	rows, err := s.db.Query(`SELECT `+appJobColumns+` FROM app_jobs WHERE user_id=? AND date=? ORDER BY started_at`, user, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []appJobRow
	for rows.Next() {
		j, err := scanAppJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

func (s *Store) deleteAppJob(id string) error {
	_, err := s.db.Exec(`DELETE FROM app_jobs WHERE id=?`, id)
	return err
}

func (s *Store) setAppJobPID(id string, pid int) error {
	_, err := s.db.Exec(`UPDATE app_jobs SET pid=? WHERE id=?`, pid, id)
	return err
}

// cleanStaleAppJobs 清掉死掉的在途任务：超过 35 分钟预算、登记的进程
// 已经不在、或受理后迟迟没登记 PID。清理后 pending 从轮询里消失，
// 页面按失败处理，与 HTTP 的「pending 消失即失败」同一条语义。
func (s *Store) cleanStaleAppJobs() {
	rows, err := s.db.Query(`SELECT id,started_at,pid FROM app_jobs`)
	if err != nil {
		return
	}
	type stale struct {
		id      string
		started time.Time
		pid     int
	}
	var all []stale
	for rows.Next() {
		var id, started string
		var pid int
		if rows.Scan(&id, &started, &pid) == nil {
			t, _ := time.Parse(time.RFC3339, started)
			all = append(all, stale{id, t, pid})
		}
	}
	rows.Close()
	now := time.Now()
	for _, j := range all {
		expired := !j.started.IsZero() && now.Sub(j.started) > appJobBudget
		dead := j.pid > 0 && !processAlive(j.pid)
		unclaimed := j.pid == 0 && !j.started.IsZero() && now.Sub(j.started) > appJobPIDGrace
		if expired || dead || unclaimed {
			_, _ = s.db.Exec(`DELETE FROM app_jobs WHERE id=?`, j.id)
		}
	}
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// appJobPending 与 HTTP 的 pendingArtifact 同一投影：重做盖在原卡位置，
// 新做追加在尾部。
func appJobPending(j appJobRow) Artifact {
	id := j.ID
	if j.UpdateID != "" {
		id = j.UpdateID
	}
	xml := "<app><title>正在现做</title><purpose>" + xmlEscape(j.Request) + "</purpose><request>" +
		xmlEscape(j.Request) + "</request><html></html><made-at>" + j.Started.UTC().Format(time.RFC3339) +
		"</made-at><degraded>0</degraded><status>pending</status></app>"
	return Artifact{ID: id, Date: j.Date, Type: "app", XML: xml}
}

func mergeAppJobs(rows []Artifact, jobs []appJobRow) []Artifact {
	if len(jobs) == 0 {
		return rows
	}
	redo := map[string]Artifact{}
	for _, j := range jobs {
		pa := appJobPending(j)
		if j.UpdateID != "" {
			redo[pa.ID] = pa
		} else {
			rows = append(rows, pa)
		}
	}
	for i := range rows {
		if pa, ok := redo[rows[i].ID]; ok {
			rows[i] = pa
		}
	}
	return rows
}

// bridgeError 让桥回包带上具体错误码（invalid_input 之外的业务错误）。
type bridgeError struct{ code string }

func (e bridgeError) Error() string { return e.code }

// bridgeDate 用页面给的本地日期。安卓上 Go 的 time.Local 是 UTC，页面按
// 手机时区算日期；两边的「今天」在跨日时段会差一天，轮询就会看不到刚
// 落库的卡。页面是日期的来源（HTTP 接口同样由客户端给日期），这里只做
// 格式与 ±2 天的合理性检查，缺省回退到进程本地日期。
func bridgeDate(given string) string {
	given = strings.TrimSpace(given)
	if given == "" {
		return time.Now().Format("2006-01-02")
	}
	parsed, err := time.Parse("2006-01-02", given)
	if err != nil {
		return time.Now().Format("2006-01-02")
	}
	now := time.Now()
	diff := parsed.Sub(now).Hours()
	if diff > 48 || diff < -48 {
		return now.Format("2006-01-02")
	}
	return given
}

func (s *Store) bridgeAppMake(r androidRequest) (object, error) {
	if !bounded(r.Request, maxAppReqRunes) || len(r.Key) > 4096 || strings.ContainsAny(r.Key, "\r\n") ||
		!validModelEndpoint(r.Endpoint) || strings.TrimSpace(r.Model) == "" || len(r.Model) > 200 {
		return nil, ErrInvalid
	}
	const user = "" // 桥是单主人库
	req := strings.TrimSpace(r.Request)
	today := bridgeDate(r.Date)
	s.cleanStaleAppJobs()
	var made int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM artifacts WHERE user_id=? AND date=? AND type='app'`, user, today).Scan(&made); err != nil {
		return nil, err
	}
	jobs, err := s.appJobRows(user, today)
	if err != nil {
		return nil, err
	}
	// 在途任务也占当日名额，连点不会绕过上限。
	if made+len(jobs) >= maxAppsPerDay {
		return nil, bridgeError{"app_limit_reached"}
	}
	// 省费去重：同一句话在途还占位卡，做成了还成品，都不再花一次生成费。
	for _, j := range jobs {
		if j.UpdateID == "" && j.Request == req {
			return object{"ok": true, "app": appJobPending(j), "status": "pending"}, nil
		}
	}
	if row, ok := s.appForRequest(user, today, req); ok {
		return object{"ok": true, "app": row, "status": "exists"}, nil
	}
	seq := made + len(jobs) + 1
	job := appJobRow{
		ID: fmt.Sprintf("app:%s:%s:%02d", user, today, seq), User: user, Date: today,
		Request: req, Endpoint: r.Endpoint, Model: strings.TrimSpace(r.Model), Seq: seq, Started: time.Now(),
	}
	if err := s.insertAppJob(job); err != nil {
		return nil, err
	}
	pid, err := appJobSpawner(s.dbPath, job.ID, r.Key)
	if err != nil {
		_ = s.deleteAppJob(job.ID)
		return nil, err
	}
	_ = s.setAppJobPID(job.ID, pid)
	return object{"ok": true, "app": appJobPending(job), "status": "pending"}, nil
}

func (s *Store) bridgeAppUpdate(r androidRequest) (object, error) {
	if r.ID == "" || !bounded(r.Request, maxAppReqRunes) || len(r.Key) > 4096 || strings.ContainsAny(r.Key, "\r\n") ||
		!validModelEndpoint(r.Endpoint) || strings.TrimSpace(r.Model) == "" || len(r.Model) > 200 {
		return nil, ErrInvalid
	}
	const user = ""
	var row Artifact
	err := s.db.QueryRow(`SELECT id,date,type,xml FROM artifacts WHERE user_id=? AND id=?`, user, r.ID).
		Scan(&row.ID, &row.Date, &row.Type, &row.XML)
	if errors.Is(err, sql.ErrNoRows) || err == nil && row.Type != "app" {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	s.cleanStaleAppJobs()
	jobID := row.ID + ":redo"
	// 同一张卡在途时再点重做：还那张占位卡，不排队第二次生成。
	if existing, ok, err := s.appJob(jobID); err != nil {
		return nil, err
	} else if ok {
		return object{"ok": true, "app": appJobPending(existing), "status": "pending"}, nil
	}
	job := appJobRow{
		ID: jobID, User: user, Date: row.Date, Request: strings.TrimSpace(r.Request),
		UpdateID: row.ID, Endpoint: r.Endpoint, Model: strings.TrimSpace(r.Model), Started: time.Now(),
	}
	if err := s.insertAppJob(job); err != nil {
		return nil, err
	}
	pid, err := appJobSpawner(s.dbPath, job.ID, r.Key)
	if err != nil {
		_ = s.deleteAppJob(job.ID)
		return nil, err
	}
	_ = s.setAppJobPID(job.ID, pid)
	return object{"ok": true, "app": appJobPending(job), "status": "pending"}, nil
}

// bridgeArtifacts 是轮询用的轻量读：不跑每日引擎，只读当日卡并把在途
// 任务投影进来。
func (s *Store) bridgeArtifacts(date string) (object, error) {
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	if _, err := time.Parse("2006-01-02", date); err != nil {
		return nil, ErrInvalid
	}
	s.cleanStaleAppJobs()
	rows, err := s.Artifacts("", date)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []Artifact{}
	}
	jobs, err := s.appJobRows("", date)
	if err != nil {
		return nil, err
	}
	return object{"ok": true, "artifacts": mergeAppJobs(rows, jobs)}, nil
}

// appJobSpawner 是可替换的测试钩子：真实实现拉起独立进程，测试里换成
// 进程内执行。
var appJobSpawner = spawnAppJobDetached

// spawnAppJobDetached 拉起 app-job 进程：Setsid 脱离进程组（桥被 12 秒
// 上限杀掉、App 退到后台都不连坐），stdin 只送密钥，stdout/stderr 进
// 私有目录的日志（超过 256KB 先清空）。
func spawnAppJobDetached(dbPath, jobID, key string) (int, error) {
	exe, err := os.Executable()
	if err != nil {
		return 0, err
	}
	cmd := exec.Command(exe, "app-job", "-db", dbPath, "-job", jobID)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return 0, err
	}
	logFile, err := appJobLog(dbPath)
	if err != nil {
		return 0, err
	}
	defer logFile.Close()
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		return 0, err
	}
	if _, err := io.WriteString(stdin, key+"\n"); err != nil {
		_ = cmd.Process.Kill()
		return 0, err
	}
	_ = stdin.Close()
	go func() { _ = cmd.Wait() }()
	return cmd.Process.Pid, nil
}

func appJobLog(dbPath string) (*os.File, error) {
	path := filepath.Join(filepath.Dir(dbPath), "app-job.log")
	if info, err := os.Stat(path); err == nil && info.Size() > appJobLogLimit {
		_ = os.Truncate(path, 0)
	}
	return os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
}

// runAppJobWorker 是独立进程的入口。任务行不存在说明已被清理或受理方
// 回滚，直接退出，不再花这笔生成费。
func runAppJobWorker(args []string) error {
	flags := flag.NewFlagSet("app-job", flag.ContinueOnError)
	path := flags.String("db", "", "private SQLite file")
	jobID := flags.String("job", "", "app job id")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || *path == "" || *jobID == "" {
		return fmt.Errorf("supply -db and -job")
	}
	key, err := readAppJobKey(os.Stdin)
	if err != nil {
		return err
	}
	db, err := OpenStore(*path)
	if err != nil {
		return err
	}
	defer db.Close()
	job, ok, err := db.appJob(*jobID)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	runAppJobOnce(db, job, key)
	return nil
}

func readAppJobKey(in io.Reader) (string, error) {
	line, err := bufio.NewReader(io.LimitReader(in, 8192)).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	key := strings.TrimRight(line, "\r\n")
	if len(key) > 4096 || strings.ContainsAny(key, "\r\n") {
		return "", fmt.Errorf("invalid key")
	}
	return key, nil
}

// ensureBridgeOwner 设备库是单主人库：artifact 的外键要求 users 行先存在。
// 每日一句的 tick 也会建这一行，但第一次生成可能发生在它之前。
func (s *Store) ensureBridgeOwner() error {
	_, err := s.db.Exec(`INSERT OR IGNORE INTO users(id,token_hash) VALUES('',randomblob(32))`)
	return err
}

// runAppJobOnce 跑一次生成并落库，结束时删任务行（成功失败都删）。
func runAppJobOnce(s *Store, job appJobRow, key string) {
	defer func() { _ = s.deleteAppJob(job.ID) }()
	if err := s.ensureBridgeOwner(); err != nil {
		fmt.Fprintln(os.Stderr, "app job owner:", err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), appJobBudget)
	defer cancel()
	extra := ""
	if job.UpdateID != "" {
		extra = redoInstruction
	}
	app, _, err := MakeMiniAppVariant(ctx, nil, job.Endpoint, job.Model, key, job.Request, time.Now(), extra)
	if err != nil {
		fmt.Fprintln(os.Stderr, "app job model:", err)
		return
	}
	now := time.Now()
	if job.UpdateID != "" {
		if err := s.upsertArtifact(job.User, Artifact{ID: job.UpdateID, Date: job.Date, Type: "app", XML: miniAppXML(app, job.Request, now)}); err != nil {
			fmt.Fprintln(os.Stderr, "app job save:", err)
		}
		return
	}
	if _, err := s.saveMiniAppSeq(job.User, app, job.Request, job.Date, now, job.Seq); err != nil {
		fmt.Fprintln(os.Stderr, "app job save:", err)
	}
}
