package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// AI 聊天导入（mothership 的读半边）：ChatGPT/Claude 导出与纯文本对话
// 先解析成对话清单，用户勾选后才落成 kind="ai-chat" 的资料原件。记忆
// 仍走既有的「本人选中才读」管线；AI 说的话不代表用户做过。

const (
	maxImportBytes     = 8 << 20
	maxImportListed    = 300
	maxImportApply     = 100
	maxImportTurnRunes = 2000
	aiChatKind         = "ai-chat"
)

type importedChat struct {
	Index   int    `json:"index"`
	Title   string `json:"title"`
	Date    string `json:"date"`
	Turns   int    `json:"turns"`
	Preview string `json:"preview"`
	TooLong bool   `json:"tooLong"`

	transcript string
}

// decodeImport 与 decode 同规矩，只是放宽到 maxImportBytes：真实导出常超 1 MiB。
func decodeImport(w http.ResponseWriter, r *http.Request, dst any) error {
	if ct := strings.ToLower(strings.TrimSpace(strings.SplitN(r.Header.Get("Content-Type"), ";", 2)[0])); ct != "application/json" {
		return problem{http.StatusUnsupportedMediaType, "content_type_json_required"}
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxImportBytes+4096))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return problem{http.StatusRequestEntityTooLarge, "request_too_large"}
		}
		return problem{http.StatusBadRequest, "invalid_json"}
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		return problem{http.StatusBadRequest, "expected_one_object"}
	}
	return nil
}

func validImportKind(kind string) bool {
	return kind == "chatgpt" || kind == "claude" || kind == "text"
}

// buildTranscript 统一成「[时间] 我：…/[时间] AI：…」，保住谁说的、何时说。
func buildTranscript(title string, turns []chatTurn) string {
	var b strings.Builder
	for _, t := range turns {
		who := "AI"
		if t.user {
			who = "我"
		}
		text := strings.TrimSpace(t.text)
		if r := utf8.RuneCountInString(text); r > maxImportTurnRunes {
			text = string([]rune(text)[:maxImportTurnRunes]) + "…"
		}
		if text == "" {
			continue
		}
		stamp := ""
		if !t.at.IsZero() {
			stamp = t.at.Format("[2006-01-02 15:04] ")
		}
		b.WriteString(stamp + who + "：" + text + "\n")
	}
	return strings.TrimSpace(b.String())
}

type chatTurn struct {
	user bool
	text string
	at   time.Time
}

func firstUserLine(turns []chatTurn) string {
	for _, t := range turns {
		if !t.user {
			continue
		}
		line := strings.TrimSpace(t.text)
		line = strings.ReplaceAll(line, "\n", " ")
		if r := utf8.RuneCountInString(line); r > 80 {
			return string([]rune(line)[:80]) + "…"
		}
		return line
	}
	return ""
}

func unixTime(v float64) time.Time {
	if v <= 0 {
		return time.Time{}
	}
	return time.Unix(int64(v), 0)
}

// parseChatGPTExport 兼容 conversations.json：宽容读取，坏条目跳过不猜。
func parseChatGPTExport(data []byte) ([]importedChat, error) {
	var raw []struct {
		Title      string  `json:"title"`
		CreateTime float64 `json:"create_time"`
		Mapping    map[string]struct {
			Message *struct {
				Author struct {
					Role string `json:"role"`
				} `json:"author"`
				Content struct {
					ContentType string `json:"content_type"`
					Parts       []any  `json:"parts"`
				} `json:"content"`
				CreateTime *float64 `json:"create_time"`
			} `json:"message"`
		} `json:"mapping"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, errors.New("不是 ChatGPT 的 conversations.json")
	}
	out := []importedChat{}
	for _, conv := range raw {
		type msg struct {
			user bool
			text string
			at   time.Time
			seq  int
		}
		msgs := []msg{}
		seq := 0
		for _, node := range conv.Mapping {
			m := node.Message
			if m == nil {
				continue
			}
			role := m.Author.Role
			if role != "user" && role != "assistant" {
				continue
			}
			if m.Content.ContentType != "text" {
				continue
			}
			var parts []string
			for _, p := range m.Content.Parts {
				if s, ok := p.(string); ok && strings.TrimSpace(s) != "" {
					parts = append(parts, s)
				}
			}
			if len(parts) == 0 {
				continue
			}
			at := time.Time{}
			if m.CreateTime != nil {
				at = unixTime(*m.CreateTime)
			}
			msgs = append(msgs, msg{user: role == "user", text: strings.Join(parts, "\n"), at: at, seq: seq})
			seq++
		}
		sort.SliceStable(msgs, func(i, j int) bool {
			ai, aj := msgs[i].at, msgs[j].at
			if !ai.IsZero() && !aj.IsZero() && !ai.Equal(aj) {
				return ai.Before(aj)
			}
			return msgs[i].seq < msgs[j].seq
		})
		turns := make([]chatTurn, 0, len(msgs))
		userTurns := 0
		for _, m := range msgs {
			turns = append(turns, chatTurn{user: m.user, text: m.text, at: m.at})
			if m.user {
				userTurns++
			}
		}
		title := strings.TrimSpace(conv.Title)
		if title == "" {
			title = "未命名对话"
		}
		out = append(out, importedChat{
			Title: title, Date: unixTime(conv.CreateTime).Format("2006-01-02"),
			Turns: userTurns, Preview: firstUserLine(turns),
			transcript: buildTranscript(title, turns),
		})
	}
	return out, nil
}

// parseClaudeExport 兼容 Claude 的 conversations.json。
func parseClaudeExport(data []byte) ([]importedChat, error) {
	var raw []struct {
		Name         string `json:"name"`
		UUID         string `json:"uuid"`
		CreatedAt    string `json:"created_at"`
		ChatMessages []struct {
			Sender    string `json:"sender"`
			Text      string `json:"text"`
			CreatedAt string `json:"created_at"`
		} `json:"chat_messages"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, errors.New("不是 Claude 的 conversations.json")
	}
	out := []importedChat{}
	for _, conv := range raw {
		turns := []chatTurn{}
		userTurns := 0
		for _, m := range conv.ChatMessages {
			at := time.Time{}
			if m.CreatedAt != "" {
				if t, err := time.Parse(time.RFC3339, m.CreatedAt); err == nil {
					at = t
				}
			}
			turns = append(turns, chatTurn{user: m.Sender == "human", text: m.Text, at: at})
			if m.Sender == "human" {
				userTurns++
			}
		}
		title := strings.TrimSpace(conv.Name)
		if title == "" {
			title = "未命名对话"
		}
		date := ""
		if conv.CreatedAt != "" {
			if t, err := time.Parse(time.RFC3339, conv.CreatedAt); err == nil {
				date = t.Format("2006-01-02")
			}
		}
		out = append(out, importedChat{
			Title: title, Date: date, Turns: userTurns, Preview: firstUserLine(turns),
			transcript: buildTranscript(title, turns),
		})
	}
	return out, nil
}

// parseTextChat 支持最朴素的「我：/AI：」（或 user:/assistant:、human:/ai:）。
func parseTextChat(text string) ([]importedChat, error) {
	// 前缀按字节切；中文前缀直接比对，英文前缀忽略大小写。
	markers := []struct {
		prefix string
		user   bool
		exact  bool
	}{
		{"我：", true, true}, {"AI：", false, true},
		{"我:", true, true}, {"AI:", false, true},
		{"user:", true, false}, {"assistant:", false, false},
		{"human:", true, false}, {"ai:", false, false},
	}
	match := func(line string) (prefix string, user bool, ok bool) {
		lower := strings.ToLower(line)
		for _, m := range markers {
			if m.exact {
				if strings.HasPrefix(line, m.prefix) {
					return m.prefix, m.user, true
				}
				continue
			}
			if strings.HasPrefix(lower, m.prefix) {
				return line[:len(m.prefix)], m.user, true
			}
		}
		return "", false, false
	}
	turns := []chatTurn{}
	var cur *chatTurn
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimRight(raw, "\r")
		if prefix, isUser, ok := match(line); ok {
			if cur != nil {
				turns = append(turns, *cur)
			}
			cur = &chatTurn{user: isUser, text: strings.TrimSpace(line[len(prefix):])}
		} else if cur != nil && strings.TrimSpace(line) != "" {
			cur.text += "\n" + strings.TrimSpace(line)
		}
	}
	if cur != nil {
		turns = append(turns, *cur)
	}
	if len(turns) == 0 {
		return nil, errors.New("没认出对话格式：需要「我：」「AI：」起头的行")
	}
	userTurns := 0
	for _, t := range turns {
		if t.user {
			userTurns++
		}
	}
	return []importedChat{{
		Title: "文本对话导入", Turns: userTurns, Preview: firstUserLine(turns),
		transcript: buildTranscript("文本对话导入", turns),
	}}, nil
}

func parseImport(kind string, data []byte) ([]importedChat, error) {
	switch kind {
	case "chatgpt":
		return parseChatGPTExport(data)
	case "claude":
		return parseClaudeExport(data)
	case "text":
		if !utf8.Valid(data) {
			return nil, errors.New("不是有效的 UTF-8 文本")
		}
		return parseTextChat(string(data))
	default:
		return nil, ErrInvalid
	}
}

// listImports 供预览接口：统一截断标记与条数上限。
func listImports(kind string, data []byte) ([]importedChat, error) {
	items, err := parseImport(kind, data)
	if err != nil {
		return nil, err
	}
	if len(items) > maxImportListed {
		items = items[:maxImportListed]
	}
	for i := range items {
		items[i].Index = i
		if utf8.RuneCountInString(items[i].transcript) > 120000 {
			items[i].TooLong = true
			items[i].transcript = ""
		}
	}
	return items, nil
}

// plainTextCompletion 供 delegate：无 schema 的普通补全。
func plainTextCompletion(ctx context.Context, client *http.Client, endpoint, model, key, system, user string) (string, error) {
	body, err := json.Marshal(map[string]any{
		"model": model, "messages": []readingMessage{{"system", system}, {"user", user}},
		"stream": false, "temperature": 0,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(body)))
	if err != nil {
		return "", errors.New("模型接口地址无效")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	caller := http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if client != nil {
		caller.Transport, caller.Timeout = client.Transport, client.Timeout
	}
	resp, err := caller.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", errors.New("无法连接配置的模型服务")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("模型接口返回 HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxModelResponse+1))
	if err != nil || len(data) > maxModelResponse {
		return "", errors.New("模型回复过大或读取失败")
	}
	var completion struct {
		Choices []struct {
			Message readingMessage `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(data, &completion) != nil || len(completion.Choices) == 0 {
		return "", errors.New("无法读取模型接口的回复")
	}
	return strings.TrimSpace(completion.Choices[0].Message.Content), nil
}
