package main

// Compatibility endpoint for legacy agent ticks. Model-backed proactive work
// is not implemented here; ticks do not invent advice or prune user history.
import (
	"database/sql"
	"strings"
	"time"
)

const artifactSchema = `
CREATE TABLE IF NOT EXISTS artifacts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 date TEXT NOT NULL, type TEXT NOT NULL, xml TEXT NOT NULL, at TEXT NOT NULL
);`

type Artifact struct {
	ID   string `json:"id"`
	Date string `json:"date"`
	Type string `json:"type"`
	XML  string `json:"xml"`
}

// nudgeCard 用与 nudge.xml 模板相同的字段词汇（badge/message/sent-at）。
// xmlEscape 转义 XML 文本内容（目标标题等用户输入）。
func xmlEscape(s string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&apos;")
	return replacer.Replace(s)
}

func (s *Store) upsertArtifact(user string, a Artifact) error {
	return s.write(func(tx *sql.Tx) error {
		if _, err := tx.Exec(artifactSchema); err != nil {
			return err
		}
		res, err := tx.Exec(`INSERT INTO artifacts(id,user_id,date,type,xml,at) VALUES(?,?,?,?,?,?)
			ON CONFLICT(id) DO UPDATE SET xml=excluded.xml, at=excluded.at
			WHERE artifacts.user_id = excluded.user_id`,
			a.ID, user, a.Date, a.Type, a.XML, time.Now().UTC().Format(time.RFC3339))
		if err != nil {
			return err
		}
		// 全局 artifact id 冲突时，另一个 owner 的行不能被覆盖。RowsAffected
		// 为 0 表示冲突行的 user_id 不同；跳过这张卡，不把它写进别人的空间。
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrConflict
		}
		return nil
	})
}

// RunAgentTick 跑一轮：为每个用户的活跃目标生成当日 nudge 卡（最近记录
// >=1 天且未停用），然后清理（每用户保留最近 500 张）。
func (s *Store) RunAgentTick(now time.Time) (int, error) {
	rows, err := s.db.Query("SELECT id FROM users ORDER BY rowid")
	if err != nil {
		return 0, err
	}
	var users []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		users = append(users, id)
	}
	rows.Close()
	made := 0
	for _, user := range users {
		n, err := s.runAgentTickForUser(user, now)
		if err != nil {
			return made, err
		}
		made += n
	}
	return made, nil
}

// RunAgentTickForUser 只跑当前认证 owner；手动 tick 不再遍历所有用户。
func (s *Store) RunAgentTickForUser(user string, now time.Time) (int, error) {
	return s.runAgentTickForUser(user, now)
}

// 每日一句：只从用户确认过、带明确日子的记忆里挑一条——今天到期的优先，
// 否则最早过期还没办的一条——写成当日 voice 卡。没有任何凭据就不写，
// 也不造话：不调用模型，不解析自由文本，日期全部来自读法换算好的 due。
// 卡与 nudge 同用 badge/message/sent-at 字段词汇，quote 与 source-id 是
// 说话的凭据。同一天幂等。
func (s *Store) runAgentTickForUser(user string, now time.Time) (int, error) {
	today := now.Format("2006-01-02")
	var spoken int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM artifacts WHERE user_id=? AND date=? AND type='voice'`, user, today).Scan(&spoken); err != nil || spoken > 0 {
		return 0, err
	}
	rows, err := s.db.Query(`SELECT id, current_text, quote, COALESCE(source_id,''), due FROM memories
		WHERE user_id=? AND confirmed=1 AND COALESCE(due,'')!='' ORDER BY rowid`, user)
	if err != nil {
		return 0, err
	}
	type candidate struct {
		id, text, quote, sourceID, due string
	}
	var dueToday, overdue *candidate
	var list []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.text, &c.quote, &c.sourceID, &c.due); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, c)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	for i := range list {
		start, end, ok := dueRange(list[i].due)
		if !ok {
			continue
		}
		day := now.In(time.Local)
		day = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.Local)
		switch {
		case !day.Before(start) && !day.After(end):
			if dueToday == nil {
				dueToday = &list[i]
			}
		case day.After(end):
			if overdue == nil || list[i].due < overdue.due {
				overdue = &list[i]
			}
		}
	}
	pick, badge := dueToday, "今天"
	if pick == nil {
		pick, badge = overdue, "还没办"
	}
	if pick == nil {
		return 0, nil
	}
	card := "<voice><badge>" + xmlEscape(badge) + "</badge><message>" + xmlEscape(pick.text) +
		"</message><quote>" + xmlEscape(pick.quote) + "</quote><source-id>" + xmlEscape(pick.sourceID) +
		"</source-id><memory-id>" + xmlEscape(pick.id) + "</memory-id>" +
		"<due>" + xmlEscape(pick.due) + "</due><sent-at>" + now.UTC().Format(time.RFC3339) + "</sent-at></voice>"
	if err := s.upsertArtifact(user, Artifact{ID: "voice:" + user + ":" + today, Date: today, Type: "voice", XML: card}); err != nil {
		return 0, err
	}
	return 1, nil
}

// dueRange 解析 normalizeDue 产出的单日或区间；解析不出就返回 ok=false，
// 由调用方跳过，不猜。
func dueRange(due string) (time.Time, time.Time, bool) {
	parts := strings.SplitN(due, "..", 2)
	start, err := time.ParseInLocation("2006-01-02", parts[0], time.Local)
	if err != nil {
		return time.Time{}, time.Time{}, false
	}
	end := start
	if len(parts) == 2 {
		if end, err = time.ParseInLocation("2006-01-02", parts[1], time.Local); err != nil {
			return time.Time{}, time.Time{}, false
		}
	}
	return start, end, true
}

// goalReviewManaged reports whether this owner+goal is under the continuous
// review gate. The follow row is kept when the follow is paused, so pausing
// also stops the old daily nudge instead of letting it bypass the gate.
func (s *Store) goalReviewManaged(user, goalID string) bool {
	var exists int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM goal_review_follows WHERE user_id=? AND goal_id=? AND deleted=0`,
		user, goalID).Scan(&exists); err != nil {
		return false
	}
	return exists > 0
}

// Artifacts 按日期取卡（客户端今天页合并用）。已纳入持续复盘的目标，旧
// nudge 卡仍保留在 artifacts 历史里，但不再投影给客户端；不删除整套记录。
func (s *Store) Artifacts(user, date string) ([]Artifact, error) {
	managed := map[string]bool{}
	mrows, err := s.db.Query(`SELECT goal_id FROM goal_review_follows WHERE user_id=? AND deleted=0`, user)
	if err != nil {
		return nil, err
	}
	for mrows.Next() {
		var id string
		if err := mrows.Scan(&id); err != nil {
			mrows.Close()
			return nil, err
		}
		managed[id] = true
	}
	if err := mrows.Err(); err != nil {
		mrows.Close()
		return nil, err
	}
	mrows.Close()
	rows, err := s.db.Query(`SELECT id,date,type,xml FROM artifacts WHERE user_id=? AND date=? ORDER BY at`, user, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Artifact
	for rows.Next() {
		var a Artifact
		if err := rows.Scan(&a.ID, &a.Date, &a.Type, &a.XML); err != nil {
			return nil, err
		}
		if a.Type == "nudge" {
			prefix := "widget:" + a.Date + ":"
			if strings.HasPrefix(a.ID, prefix) && managed[strings.TrimPrefix(a.ID, prefix)] {
				continue
			}
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
