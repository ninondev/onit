package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func chatgptFixture() string {
	return `[{"title":"搬家","create_time":1762000000,
	  "mapping":{
	    "a":{"message":{"author":{"role":"user"},"content":{"content_type":"text","parts":["我在考虑搬去上海"]},"create_time":1762000000}},
	    "b":{"message":{"author":{"role":"assistant"},"content":{"content_type":"text","parts":["给你列一个搬家计划"]},"create_time":1762000060}},
	    "c":{"message":{"author":{"role":"user"},"content":{"content_type":"text","parts":["先不急，年底再说"]},"create_time":1762000120}}
	  }},
	 {"title":"练琴","create_time":1762100000,
	  "mapping":{
	    "a":{"message":{"author":{"role":"user"},"content":{"content_type":"text","parts":["每周练几次琴合适"]},"create_time":1762100000}},
	    "b":{"message":{"author":{"role":"assistant"},"content":{"content_type":"text","parts":["建议三次"]},"create_time":1762100060}}
	  }}]`
}

func claudeFixture() string {
	return `[{"name":"旅行计划","created_at":"2026-10-03T08:00:00Z",
	  "chat_messages":[
	    {"sender":"human","text":"十一想带家里人去海边","created_at":"2026-10-03T08:00:00Z"},
	    {"sender":"assistant","text":"这里是三个方案","created_at":"2026-10-03T08:01:00Z"}]},
	 {"name":"读书","created_at":"2026-10-05T09:00:00Z",
	  "chat_messages":[
	    {"sender":"human","text":"今年想读完二十本书","created_at":"2026-10-05T09:00:00Z"}]}]`
}

func TestParseImportsKeepWhoSaidWhat(t *testing.T) {
	cg, err := parseImport("chatgpt", []byte(chatgptFixture()))
	if err != nil || len(cg) != 2 {
		t.Fatalf("chatgpt parse: %v %d", err, len(cg))
	}
	if cg[0].Title != "搬家" || cg[0].Turns != 2 || !strings.Contains(cg[0].transcript, "我：我在考虑搬去上海") ||
		!strings.Contains(cg[0].transcript, "AI：给你列一个搬家计划") {
		t.Fatalf("chatgpt conversation wrong: %+v", cg[0])
	}
	if !strings.Contains(cg[0].transcript, "[") {
		t.Fatal("transcript lost timestamps")
	}
	cl, err := parseImport("claude", []byte(claudeFixture()))
	if err != nil || len(cl) != 2 || cl[0].Turns != 1 || cl[0].Date != "2026-10-03" {
		t.Fatalf("claude parse: %v %+v", err, cl)
	}
	tx, err := parseImport("text", []byte("我：想学游泳\nAI：先练憋气\n续行也算它说的\n我：好"))
	if err != nil || len(tx) != 1 || tx[0].Turns != 2 || !strings.Contains(tx[0].transcript, "AI：先练憋气\n续行也算它说的") {
		t.Fatalf("text parse: %v %+v", err, tx)
	}
	if _, err := parseImport("text", []byte("没有任何标记")); err == nil {
		t.Fatal("unmarked text accepted")
	}
}

func TestImportPreviewAndApplyCreateAISources(t *testing.T) {
	db, err := OpenStore(filepath.Join(t.TempDir(), "import.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server := httptest.NewServer(newService(db, Model{}))
	defer server.Close()
	user, token := storeUser(t, db)
	_ = user
	preview := apiCall(t, server.URL, token, "POST", "/v1/imports/preview",
		map[string]string{"kind": "chatgpt", "text": chatgptFixture()}, 200)
	if !strings.Contains(string(preview), "搬家") || !strings.Contains(string(preview), "练琴") {
		t.Fatalf("preview missing conversations: %s", preview)
	}
	apiCall(t, server.URL, token, "POST", "/v1/imports/preview",
		map[string]string{"kind": "chatgpt", "text": "不是json"}, 422)
	// 只勾第一段。
	applied := apiCall(t, server.URL, token, "POST", "/v1/imports/apply",
		map[string]any{"kind": "chatgpt", "text": chatgptFixture(), "selected": []int{0}}, 200)
	if strings.Count(string(applied), `"id"`) != 1 || !strings.Contains(string(applied), aiChatKind) {
		t.Fatalf("apply created wrong rows: %s", applied)
	}
	// 越界勾选拒。
	apiCall(t, server.URL, token, "POST", "/v1/imports/apply",
		map[string]any{"kind": "chatgpt", "text": chatgptFixture(), "selected": []int{9}}, 400)
	// 重复导入同一段：按 digest 幂等，不产生第二条。
	apiCall(t, server.URL, token, "POST", "/v1/imports/apply",
		map[string]any{"kind": "chatgpt", "text": chatgptFixture(), "selected": []int{0}}, 200)
	sources := unpack[[]map[string]any](t, apiCall(t, server.URL, token, "GET", "/v1/sources", nil, 200))
	if len(sources) != 1 {
		t.Fatalf("expected one source, got %d", len(sources))
	}
	// 读法指令必须把「AI 说的≠用户做过」讲给模型。
	if !strings.Contains(readingInstruction(aiChatKind, "我：想学游泳", time.Now()), "不代表用户做过") {
		t.Fatal("ai-chat reading instruction lost the assistant disclaimer")
	}
}

func TestDelegateReturnsHelperDraft(t *testing.T) {
	var mu sync.Mutex
	seen := ""
	helper := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		seen = string(body)
		mu.Unlock()
		respond(w, 200, map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "草稿：先列三步。"}}}})
	}))
	defer helper.Close()
	cfg := Model{Endpoint: helper.URL, Name: "main-model"}
	db, err := OpenStore(filepath.Join(t.TempDir(), "delegate.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server := httptest.NewServer(newService(db, cfg))
	defer server.Close()
	_, token := storeUser(t, db)
	call := func(payload map[string]string, want int) []byte {
		return apiCall(t, server.URL, token, "POST", "/v1/delegate", payload, want)
	}
	// 帮手模型名与主模型不同是允许的：端点必须一致，防偷换目的地。
	out := call(map[string]string{"endpoint": cfg.Endpoint, "model": "mistral/deepseek-v4", "request": "帮我列搬家清单"}, 200)
	if !strings.Contains(string(out), "草稿：先列三步") || !strings.Contains(string(out), "deepseek") {
		t.Fatalf("delegate reply wrong: %s", out)
	}
	mu.Lock()
	if !strings.Contains(seen, "mistral/deepseek-v4") || !strings.Contains(seen, "搬家清单") {
		t.Fatalf("helper request wrong: %s", seen)
	}
	mu.Unlock()
	call(map[string]string{"endpoint": cfg.Endpoint + "/x", "model": "m", "request": "x"}, 409)
	call(map[string]string{"endpoint": cfg.Endpoint, "model": "m", "request": " "}, 400)
}
