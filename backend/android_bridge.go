package main

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

type androidRequest struct {
	Op               string          `json:"op"`
	CompleteReadings bool            `json:"completeReadings"`
	Revision         *int            `json:"revision"`
	Base             string          `json:"base"`
	State            json.RawMessage `json:"state"`
	Source           string          `json:"source"`
	Kind             string          `json:"kind"`
	Origin           string          `json:"origin"`
	Title            string          `json:"title"`
	Action           string          `json:"action"`
	GoalID           string          `json:"goalId"`
	Request          string          `json:"request"`
	MemoryID         string          `json:"memoryId"`
	Text             string          `json:"text"`
	ID               string          `json:"id"`
	Date             string          `json:"date"`
	Endpoint         string          `json:"endpoint"`
	Model            string          `json:"model"`
	Key              string          `json:"key"`
}

func (s *Store) androidRequest(raw []byte) (object, error) {
	var r androidRequest
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, ErrInvalid
	}
	switch r.Op {
	case "read":
		if r.CompleteReadings {
			var user string
			err := s.db.QueryRow("SELECT user_id FROM android_dossier WHERE slot=1").Scan(&user)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return nil, err
			}
			if user != "" {
				if err = s.completeStoredReadings(user); err != nil {
					return nil, err
				}
			}
		}
		return s.androidState(nil, nil, "")
	case "write":
		if r.Revision == nil || *r.Revision < 0 {
			return nil, ErrInvalid
		}
		state, err := parseObject(r.State)
		if err != nil {
			return nil, err
		}
		return s.androidState(r.Revision, state, r.Base)
	case "tick":
		reply, err := s.runProactiveTick(r.Source)
		if err != nil {
			return nil, err
		}
		// 每日一句与状态世界的准备卡同一轮带出：引擎只写当日 artifact，
		// 出声与否由调用方（页面展示或系统通知）决定。
		s.attachDailyVoice(reply)
		return reply, nil
	case "voice-act":
		return s.voiceAct("", r.MemoryID, r.Action, r.Text)
	case "app-make":
		return s.bridgeAppMake(r)
	case "app-update":
		return s.bridgeAppUpdate(r)
	case "artifacts":
		return s.bridgeArtifacts(r.Date)
	case "source-add":
		return s.androidSourceAdd(r.Kind, r.Origin, r.Title, r.Text)
	case "sources":
		return s.androidSources()
	case "policy":
		return proactivePolicyReply(s.dbPath), nil
	case "goalreview":
		if r.GoalID == "" || !bounded(r.Request, grMaxRequest) {
			return nil, ErrInvalid
		}
		action := r.Action
		if action == "" {
			action = grActionShow
		}
		review, err := s.GoalReview("", r.GoalID, action, r.Request)
		if err != nil {
			return nil, err
		}
		// The review write advanced the dossier revision. Return the token the
		// WebView must adopt so its next edit is based on the state it just read.
		state, err := s.androidState(nil, nil, "")
		if err != nil {
			return nil, err
		}
		return object{"ok": true, "review": review, "revision": state["revision"], "snapshot": state["snapshot"]}, nil
	default:
		return nil, ErrInvalid
	}
}

func runAndroidBridge(s *Store, in io.Reader, out io.Writer) error {
	reader := bufio.NewReader(in)
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			response, requestErr := s.androidRequest(line)
			if requestErr != nil {
				code := "storage_error"
				var business bridgeError
				if errors.As(requestErr, &business) {
					code = business.code
				} else if errors.Is(requestErr, ErrConflict) {
					code = "revision_changed"
				} else if errors.Is(requestErr, ErrInvalid) {
					code = "invalid_input"
				} else if errors.Is(requestErr, ErrNotFound) {
					code = "not_found"
				}
				response = object{"ok": false, "error": code}
			}
			if writeErr := enc.Encode(response); writeErr != nil {
				return writeErr
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

// voiceCardFields 解析引擎当日写的 voice 卡。XML 由本机引擎生成，可信。
type voiceCardFields struct {
	Badge    string `xml:"badge"`
	Message  string `xml:"message"`
	Quote    string `xml:"quote"`
	SourceID string `xml:"source-id"`
	MemoryID string `xml:"memory-id"`
	Due      string `xml:"due"`
	SentAt   string `xml:"sent-at"`
}

// attachDailyVoice 在桥 tick 回复里附上今天的每日一句，并把当日
// artifacts（voice/app）一并带给页面，APK 里的 WebView 没有 HTTP
// 服务可拉，只能从这一轮拿全。引擎只写当日 artifact；要不要出声
// （页面展示、系统通知）由调用方决定。失败只落 stderr，不让准备
// 卡那一轮陪绑。
func (s *Store) attachDailyVoice(reply object) {
	const user = "" // 桥是单主人库
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO users(id,token_hash) VALUES('',randomblob(32))`); err != nil {
		fmt.Fprintln(os.Stderr, "daily voice owner:", err)
		return
	}
	if _, err := s.runAgentTickForUser(user, time.Now()); err != nil {
		fmt.Fprintln(os.Stderr, "daily voice tick:", err)
	}
	rows, err := s.Artifacts(user, time.Now().Format("2006-01-02"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "daily voice artifacts:", err)
		return
	}
	var apps []object
	for _, a := range rows {
		if a.Type == "app" {
			apps = append(apps, object{"id": a.ID, "type": a.Type, "xml": a.XML})
			continue
		}
		if a.Type != "voice" {
			continue
		}
		var card voiceCardFields
		if err := xml.Unmarshal([]byte(a.XML), &card); err != nil || card.Message == "" {
			continue
		}
		reply["voice"] = object{
			"badge": card.Badge, "message": card.Message, "quote": card.Quote,
			"sourceId": card.SourceID, "memoryId": card.MemoryID,
			"due": card.Due, "sentAt": card.SentAt,
		}
	}
	if len(apps) > 0 {
		reply["artifacts"] = apps
	}
}

// voiceAct 处理通知栏与页面共用的三动作。确认不改字：拿当前文本走同
// 一改写路径；版本号由库里现查，调用方不需要知道。桥模式是单主人库
// （user ""），HTTP 模式按持有 token 的主人。
func (s *Store) voiceAct(user, memoryID, action, text string) (object, error) {
	if memoryID == "" {
		return nil, ErrInvalid
	}
	switch action {
	case "confirm", "rewrite":
		m, _, err := readMemory(s.db.QueryRow("SELECT "+memoryColumns+" FROM memories WHERE user_id=? AND id=?", user, memoryID))
		if err != nil {
			return nil, err
		}
		next := m.Text
		if action == "rewrite" {
			if !bounded(text, 1000) {
				return nil, ErrInvalid
			}
			next = strings.TrimSpace(text)
		}
		row, err := s.Correct(user, memoryID, next, m.Version)
		if err != nil {
			return nil, err
		}
		return object{"ok": true, "memory": row}, nil
	case "drop":
		if err := s.Forget(user, memoryID); err != nil {
			return nil, err
		}
		return object{"ok": true, "forgotten": true}, nil
	default:
		return nil, ErrInvalid
	}
}
