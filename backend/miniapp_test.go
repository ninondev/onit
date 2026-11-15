package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func mustMarshalApp(t *testing.T, app miniApp) string {
	t.Helper()
	body, err := json.Marshal(map[string]any{"app": app})
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func TestMiniAppGuardrailsRejectUnsafeHTML(t *testing.T) {
	good := miniApp{Title: "旅行基金", Purpose: "存旅行钱，看还差多少。",
		HTML: `<div class="app-card"><p class="num" id="v"></p><button class="btn" onclick="add()">存 100</button></div><script>function add(){store.set("v",(store.get("v",0)+100));document.getElementById("v").textContent=store.get("v",0)}</script>`}
	if err := validateMiniApp(good); err != nil {
		t.Fatalf("good app rejected: %v", err)
	}
	// 改革后网络与外码放开：https 资源与 fetch 必须能过。
	net := good
	net.HTML = `<img src="https://cdn.example/a.png"><script src="https://cdn.example/lib.js"></script>` +
		`<script>fetch("https://api.example/rate").then(r=>r.json())</script>`
	if err := validateMiniApp(net); err != nil {
		t.Fatalf("networked app rejected after reform: %v", err)
	}
	banned := []struct{ name, html string }{
		{"storage", `<script>localStorage.setItem("a",1)</script>`},
		{"navigation", `<script>location.assign("/x")</script>`},
		{"anchor", `<a href="#">打开</a>`},
		{"eval", `<script>eval("1")</script>`},
		{"postmessage", `<script>parent.postMessage("hi","*")</script>`},
		{"import", `<script>import("x")</script>`},
		{"iframe", `<iframe></iframe>`},
		{"meta", `<meta charset="utf-8">`},
	}
	for _, b := range banned {
		bad := good
		bad.HTML = b.html
		if err := validateMiniApp(bad); err == nil {
			t.Fatalf("%s slipped through the guardrail", b.name)
		}
	}
	oversize := good
	oversize.HTML = "<div>" + strings.Repeat("字", 17000) + "</div>"
	if err := validateMiniApp(oversize); err == nil {
		t.Fatal("oversized html accepted")
	}
	// 语法坏了的应用不许落库：2026-11-13 降压药板真实事故（JSON.parse 少右括号）。
	brokenJS := good
	brokenJS.HTML = `<div id="v"></div><script>var o=JSON.parse(store.get("k",'{"a":1}');document.getElementById("v").textContent=o.a</script>`
	if err := validateMiniApp(brokenJS); err == nil {
		t.Fatal("broken inline script accepted")
	}
	// 外部库 script 带 src=，本地不解析，必须放行。
	withLib := good
	withLib.HTML = `<div></div><script src="https://cdn.example/lib.js"></script><script>var a=1;</script>`
	if err := validateMiniApp(withLib); err != nil {
		t.Fatalf("script with src rejected: %v", err)
	}
	longTitle := good
	longTitle.Title = strings.Repeat("字", 17)
	if err := validateMiniApp(longTitle); err == nil {
		t.Fatal("oversized title accepted")
	}
}

func appModelHost(t *testing.T, replies []string) (*httptest.Server, *[]string) {
	t.Helper()
	var mu sync.Mutex
	seen := []string{}
	idx := 0
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		seen = append(seen, string(body))
		reply := replies[idx]
		idx++
		mu.Unlock()
		respond(w, 200, map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": reply}}}})
	}))
	t.Cleanup(host.Close)
	return host, &seen
}

// pollApp 等异步任务落库：先见 pending 投影，再见真应用。
func pollApp(t *testing.T, server *httptest.Server, token string) []Artifact {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var rows []Artifact
	sawPending := false
	for time.Now().Before(deadline) {
		var listed struct {
			Artifacts []Artifact `json:"artifacts"`
		}
		if err := json.Unmarshal(apiCall(t, server.URL, token, "GET", "/v1/artifacts/"+time.Now().Format("2006-01-02"), nil, 200), &listed); err != nil {
			t.Fatal(err)
		}
		rows = listed.Artifacts
		if len(rows) > 0 && strings.Contains(rows[len(rows)-1].XML, "<status>pending</status>") {
			sawPending = true
		}
		// 首行不再是占位即视为落地（任务可能在首次轮询前就完成）。
		if len(rows) > 0 && !strings.Contains(rows[0].XML, "<status>pending</status>") {
			_ = sawPending
			return rows
		}
		time.Sleep(30 * time.Millisecond)
	}
	t.Fatal("async app never landed")
	return nil
}

func TestAppMakeAsyncRetriesThenLands(t *testing.T) {
	bad := mustMarshalApp(t, miniApp{Title: "打卡", Purpose: "喝水打卡。",
		HTML: `<script>location.assign("//evil")</script>`})
	clean := mustMarshalApp(t, miniApp{Title: "喝水打卡", Purpose: "一天八杯，点了就记。",
		HTML: `<div class="app-card"><p class="num" id="n"></p><button class="btn" onclick="tap()">喝了一杯</button></div><script>function tap(){store.set("n",store.get("n",0)+1);document.getElementById("n").textContent=store.get("n",0)}</script>`})
	host, seen := appModelHost(t, []string{bad, clean})
	cfg := Model{Endpoint: host.URL, Name: "user-selected"}
	db, err := OpenStore(filepath.Join(t.TempDir(), "miniapp.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server := httptest.NewServer(newService(db, cfg))
	defer server.Close()
	user, token := storeUser(t, db)
	payload := map[string]string{"endpoint": cfg.Endpoint, "model": cfg.Name, "request": "帮我做个喝水打卡的小应用"}
	// 异步 202：受理即回，不等模型。
	var accepted struct {
		App    Artifact `json:"app"`
		Status string   `json:"status"`
	}
	if err := json.Unmarshal(apiCall(t, server.URL, token, "POST", "/v1/apps/make", payload, 202), &accepted); err != nil {
		t.Fatal(err)
	}
	if accepted.Status != "pending" || !strings.Contains(accepted.App.XML, "<status>pending</status>") {
		t.Fatalf("expected pending acceptance, got %+v", accepted)
	}
	rows := pollApp(t, server, token)
	if len(rows) != 1 || !strings.HasPrefix(rows[0].ID, "app:"+user+":") {
		t.Fatalf("artifact not listed: %+v", rows)
	}
	if !strings.Contains(rows[0].XML, "喝水打卡") || strings.Contains(rows[0].XML, "location.assign") {
		t.Fatalf("stored xml wrong: %s", rows[0].XML)
	}
	// 重试调用的系统提示必须带上第一次被拒的原因，模型才有得修。
	if len(*seen) != 2 || !strings.Contains((*seen)[1], "违反了规则") {
		t.Fatalf("retry prompt missing rejection reason, calls=%d", len(*seen))
	}
	// 偷换模型目的地直接拒；空请求 400。
	payload["endpoint"] = cfg.Endpoint + "/other"
	apiCall(t, server.URL, token, "POST", "/v1/apps/make", payload, 409)
	payload["endpoint"] = cfg.Endpoint
	payload["request"] = " "
	apiCall(t, server.URL, token, "POST", "/v1/apps/make", payload, 400)
}

// 同一句话当天重复要：直接还已做成的那张卡，模型一次都不多打（省费去重）。
func TestAppMakeDedupesSameRequestSameDay(t *testing.T) {
	clean := mustMarshalApp(t, miniApp{Title: "喝水打卡", Purpose: "一天八杯，点了就记。",
		HTML: `<div class="app-card"><p class="num" id="n"></p><button class="btn" onclick="tap()">喝了一杯</button></div><script>function tap(){store.set("n",store.get("n",0)+1);document.getElementById("n").textContent=store.get("n",0)}</script>`})
	host, seen := appModelHost(t, []string{clean, clean})
	cfg := Model{Endpoint: host.URL, Name: "user-selected"}
	db, err := OpenStore(filepath.Join(t.TempDir(), "miniapp.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server := httptest.NewServer(newService(db, cfg))
	defer server.Close()
	_, token := storeUser(t, db)
	payload := map[string]string{"endpoint": cfg.Endpoint, "model": cfg.Name, "request": "帮我做个喝水打卡的小应用"}
	apiCall(t, server.URL, token, "POST", "/v1/apps/make", payload, 202)
	rows := pollApp(t, server, token)
	if len(rows) != 1 {
		t.Fatalf("artifact not listed: %+v", rows)
	}
	var again struct {
		App    Artifact `json:"app"`
		Status string   `json:"status"`
	}
	if err := json.Unmarshal(apiCall(t, server.URL, token, "POST", "/v1/apps/make", payload, 200), &again); err != nil {
		t.Fatal(err)
	}
	if again.Status != "exists" || again.App.ID != rows[0].ID {
		t.Fatalf("duplicate request should return the existing app, got %+v", again)
	}
	if len(*seen) != 1 {
		t.Fatalf("model called %d times for a duplicate request", len(*seen))
	}
	// 换个说法是新需求，照常受理新任务。
	payload["request"] = "帮我做个喝水打卡，要能看一周的记录"
	apiCall(t, server.URL, token, "POST", "/v1/apps/make", payload, 202)
}

func TestAppUpdateKeepsStableID(t *testing.T) {
	first := mustMarshalApp(t, miniApp{Title: "账本", Purpose: "记账。",
		HTML: `<div>账本 v1</div>`})
	second := mustMarshalApp(t, miniApp{Title: "账本", Purpose: "记账，带周汇总。",
		HTML: `<div>账本 v2 store.keys()</div>`})
	host, _ := appModelHost(t, []string{first, second})
	cfg := Model{Endpoint: host.URL, Name: "user-selected"}
	db, err := OpenStore(filepath.Join(t.TempDir(), "miniapp-update.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server := httptest.NewServer(newService(db, cfg))
	defer server.Close()
	_, token := storeUser(t, db)
	payload := map[string]string{"endpoint": cfg.Endpoint, "model": cfg.Name, "request": "做个账本"}
	apiCall(t, server.URL, token, "POST", "/v1/apps/make", payload, 202)
	rows := pollApp(t, server, token)
	origID := rows[0].ID
	if !strings.Contains(rows[0].XML, "账本 v1") {
		t.Fatalf("first app wrong: %s", rows[0].XML)
	}
	// 稳定身份重做：id 不变，内容换新，重做指令带键兼容要求。
	update := map[string]string{"endpoint": cfg.Endpoint, "model": cfg.Name, "id": origID, "request": "加个周汇总"}
	apiCall(t, server.URL, token, "POST", "/v1/apps/update", update, 202)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var listed struct {
			Artifacts []Artifact `json:"artifacts"`
		}
		if err := json.Unmarshal(apiCall(t, server.URL, token, "GET", "/v1/artifacts/"+time.Now().Format("2006-01-02"), nil, 200), &listed); err != nil {
			t.Fatal(err)
		}
		if len(listed.Artifacts) == 1 && listed.Artifacts[0].ID == origID && strings.Contains(listed.Artifacts[0].XML, "账本 v2") {
			return // id 稳定 + 内容换新，验收通过
		}
		time.Sleep(30 * time.Millisecond)
	}
	t.Fatal("update did not keep stable id with new content")
}

func TestAppMakeDegradesToTextCardAfterTwoFailures(t *testing.T) {
	bad := mustMarshalApp(t, miniApp{Title: "账本", Purpose: "记账。",
		HTML: `<script>localStorage.setItem("a",1)</script>`})
	host, _ := appModelHost(t, []string{bad, bad})
	cfg := Model{Endpoint: host.URL, Name: "user-selected"}
	db, err := OpenStore(filepath.Join(t.TempDir(), "miniapp2.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server := httptest.NewServer(newService(db, cfg))
	defer server.Close()
	_, token := storeUser(t, db)
	payload := map[string]string{"endpoint": cfg.Endpoint, "model": cfg.Name, "request": "做个旅行基金"}
	apiCall(t, server.URL, token, "POST", "/v1/apps/make", payload, 202)
	rows := pollApp(t, server, token)
	if !strings.Contains(rows[0].XML, "<degraded>1</degraded>") || !strings.Contains(rows[0].XML, "旅行基金") {
		t.Fatalf("degraded card wrong: %s", rows[0].XML)
	}
	if strings.Contains(rows[0].XML, "localstorage") {
		t.Fatal("degraded card kept unsafe html")
	}
}

func TestAppMakeWithoutConfiguredModel(t *testing.T) {
	db, err := OpenStore(filepath.Join(t.TempDir(), "miniapp3.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server := httptest.NewServer(newService(db, Model{}))
	defer server.Close()
	_, token := storeUser(t, db)
	apiCall(t, server.URL, token, "POST", "/v1/apps/make", map[string]string{"request": "做个账本"}, 409)
}
