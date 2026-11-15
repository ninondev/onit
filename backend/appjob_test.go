package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// deviceRig 是设备阶段的测试台：同一个库、同一个桥请求入口，生成进程
// 换成进程内执行（真机上由 Setsid 拉起的 app-job 进程干同一件事）。
type deviceRig struct {
	t     *testing.T
	store *Store
	model string
	mu    sync.Mutex
	keys  []string
	work  sync.WaitGroup
}

func newDeviceRig(t *testing.T, host *httptest.Server) *deviceRig {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "device.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	rig := &deviceRig{t: t, store: store, model: host.URL}
	old := appJobSpawner
	appJobSpawner = func(dbPath, jobID, key string) (int, error) {
		rig.mu.Lock()
		rig.keys = append(rig.keys, key)
		rig.mu.Unlock()
		job, ok, err := store.appJob(jobID)
		if err != nil {
			return 0, err
		}
		if ok {
			rig.work.Add(1)
			go func() {
				defer rig.work.Done()
				runAppJobOnce(store, job, key)
			}()
		}
		return 0, nil
	}
	t.Cleanup(func() { appJobSpawner = old })
	t.Cleanup(func() { rig.work.Wait() })
	return rig
}

func (r *deviceRig) call(payload map[string]any) object {
	r.t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		r.t.Fatal(err)
	}
	reply, err := r.store.androidRequest(raw)
	if err != nil {
		r.t.Fatalf("%v: %v", payload["op"], err)
	}
	return reply
}

func (r *deviceRig) artifacts() []Artifact {
	r.t.Helper()
	reply := r.call(map[string]any{"op": "artifacts"})
	list, _ := reply["artifacts"].([]Artifact)
	return list
}

func (r *deviceRig) artifactsOn(date string) []Artifact {
	r.t.Helper()
	reply := r.call(map[string]any{"op": "artifacts", "date": date})
	list, _ := reply["artifacts"].([]Artifact)
	return list
}

func (r *deviceRig) makeRequest(request string) object {
	return r.call(map[string]any{
		"op": "app-make", "request": request, "endpoint": r.model,
		"model": "user-selected", "key": "sk-device-test",
		"date": time.Now().Format("2006-01-02"),
	})
}

func (r *deviceRig) updateRequest(id, request string) object {
	return r.call(map[string]any{
		"op": "app-update", "id": id, "request": request,
		"endpoint": r.model, "model": "user-selected", "key": "sk-device-test",
		"date": time.Now().Format("2006-01-02"),
	})
}

func (r *deviceRig) waitFor(appID string, ok func(Artifact) bool) Artifact {
	r.t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		for _, a := range r.artifacts() {
			if a.ID == appID && ok(a) {
				return a
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	r.t.Fatalf("app %s never reached the expected state", appID)
	return Artifact{}
}

func cleanAppReply(t *testing.T, title string) string {
	t.Helper()
	return mustMarshalApp(t, miniApp{Title: title, Purpose: "点一下就记。",
		HTML: `<div class="app-card"><p class="num" id="n"></p><button class="btn" onclick="tap()">记一次</button></div><script>function tap(){store.set("n",store.get("n",0)+1);document.getElementById("n").textContent=store.get("n",0)}</script>`})
}

func TestBridgeAppMakeLandsAndKeepsKeyOffArgv(t *testing.T) {
	host, seen := appModelHost(t, []string{cleanAppReply(t, "喝水打卡")})
	rig := newDeviceRig(t, host)
	reply := rig.makeRequest("帮我做个喝水打卡的小应用")
	if reply["ok"] != true || reply["status"] != "pending" {
		t.Fatalf("acceptance wrong: %+v", reply)
	}
	pending, _ := reply["app"].(Artifact)
	if !strings.Contains(pending.XML, "<status>pending</status>") || pending.ID == "" {
		t.Fatalf("pending projection wrong: %+v", pending)
	}
	landed := rig.waitFor(pending.ID, func(a Artifact) bool {
		return !strings.Contains(a.XML, "<status>pending</status>")
	})
	if !strings.Contains(landed.XML, "喝水打卡") || landed.Type != "app" {
		t.Fatalf("stored xml wrong: %s", landed.XML)
	}
	if !strings.HasPrefix(landed.ID, "app::") {
		t.Fatalf("device artifact id should use the single-owner prefix: %s", landed.ID)
	}
	// 任务行在完成时删掉，轮询不再看到占位。
	if jobs, _ := rig.store.appJobRows("", time.Now().Format("2006-01-02")); len(jobs) != 0 {
		t.Fatalf("job row left behind: %+v", jobs)
	}
	// 密钥只走 stdin 钩子，不进 argv。
	rig.mu.Lock()
	keys := append([]string(nil), rig.keys...)
	rig.mu.Unlock()
	if len(keys) != 1 || keys[0] != "sk-device-test" {
		t.Fatalf("key not passed to the worker: %v", keys)
	}
	if len(*seen) != 1 {
		t.Fatalf("model calls = %d, want 1", len(*seen))
	}
}

func TestBridgeAppMakeDedupesAndRejectsBadInput(t *testing.T) {
	host, seen := appModelHost(t, []string{cleanAppReply(t, "喝水打卡")})
	rig := newDeviceRig(t, host)
	first := rig.makeRequest("帮我做个喝水打卡的小应用")
	app, _ := first["app"].(Artifact)
	rig.waitFor(app.ID, func(a Artifact) bool {
		return !strings.Contains(a.XML, "<status>pending</status>")
	})
	// 同一句话再来：还成品，不再花一次生成费。
	again := rig.makeRequest("帮我做个喝水打卡的小应用")
	if again["status"] != "exists" {
		t.Fatalf("duplicate should return exists: %+v", again)
	}
	if len(*seen) != 1 {
		t.Fatalf("model called %d times for a duplicate", len(*seen))
	}
	// 空请求、公网 http 目的地都拒。
	if _, err := rig.store.androidRequest([]byte(`{"op":"app-make","request":" ","endpoint":"` + host.URL + `","model":"m"}`)); err == nil {
		t.Fatal("blank request accepted")
	}
	if _, err := rig.store.androidRequest([]byte(`{"op":"app-make","request":"做个东西","endpoint":"http://example.com/v1","model":"m"}`)); err == nil {
		t.Fatal("public http endpoint accepted")
	}
}

func TestBridgeAppUpdateKeepsStableID(t *testing.T) {
	host, _ := appModelHost(t, []string{cleanAppReply(t, "账本"), cleanAppReply(t, "账本二版")})
	rig := newDeviceRig(t, host)
	first := rig.makeRequest("做个账本")
	app, _ := first["app"].(Artifact)
	rig.waitFor(app.ID, func(a Artifact) bool {
		return !strings.Contains(a.XML, "<status>pending</status>") && strings.Contains(a.XML, "账本")
	})
	reply := rig.updateRequest(app.ID, "加个周汇总")
	if reply["ok"] != true || reply["status"] != "pending" {
		t.Fatalf("redo acceptance wrong: %+v", reply)
	}
	pending, _ := reply["app"].(Artifact)
	if pending.ID != app.ID {
		t.Fatalf("redo projection must cover the original card: %s vs %s", pending.ID, app.ID)
	}
	landed := rig.waitFor(app.ID, func(a Artifact) bool {
		return strings.Contains(a.XML, "账本二版")
	})
	if landed.Type != "app" {
		t.Fatalf("redo artifact type wrong: %+v", landed)
	}
	// 不存在的 id 回 not_found。
	if _, err := rig.store.androidRequest([]byte(`{"op":"app-update","id":"app:nope","request":"改","endpoint":"` + host.URL + `","model":"m"}`)); err != ErrNotFound {
		t.Fatalf("missing app should be not_found, got %v", err)
	}
}

// 安卓上 Go 的本地时区是 UTC，页面按手机时区算日期。页面给的日期就是
// 落库日期与轮询日期，否则跨日时段轮询看不到刚做好的卡。
func TestBridgeAppMakeUsesPageDate(t *testing.T) {
	host, _ := appModelHost(t, []string{cleanAppReply(t, "跨日")})
	rig := newDeviceRig(t, host)
	pageDate := time.Now().Add(24 * time.Hour).Format("2006-01-02")
	reply := rig.call(map[string]any{
		"op": "app-make", "request": "做个跨日测试", "endpoint": host.URL,
		"model": "user-selected", "key": "sk-device-test", "date": pageDate,
	})
	app, _ := reply["app"].(Artifact)
	if app.Date != pageDate {
		t.Fatalf("pending projection date = %q, want %q", app.Date, pageDate)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		for _, a := range rig.artifactsOn(pageDate) {
			if a.ID == app.ID && !strings.Contains(a.XML, "<status>pending</status>") {
				if a.Date != pageDate || !strings.Contains(a.ID, pageDate) {
					t.Fatalf("landed artifact not on the page date: %+v", a)
				}
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("app %s never landed on %s", app.ID, pageDate)
}

func TestBridgeAppMakeFailureLeavesNothing(t *testing.T) {
	fail := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "model down", http.StatusInternalServerError)
	}))
	t.Cleanup(fail.Close)
	rig := newDeviceRig(t, fail)
	reply := rig.makeRequest("做个做不成的东西")
	app, _ := reply["app"].(Artifact)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if len(rig.artifacts()) == 0 { // 占位消失，什么都没留下
			if jobs, _ := rig.store.appJobRows("", time.Now().Format("2006-01-02")); len(jobs) == 0 {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("failed make left state behind for %s", app.ID)
}

func TestBridgeAppRedoFailureKeepsOldCard(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		first := calls == 1
		mu.Unlock()
		if !first {
			http.Error(w, "model down", http.StatusInternalServerError)
			return
		}
		reply := cleanAppReply(t, "账本")
		respond(w, 200, map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": reply}}}})
	}))
	t.Cleanup(host.Close)
	rig := newDeviceRig(t, host)
	first := rig.makeRequest("做个账本")
	app, _ := first["app"].(Artifact)
	landed := rig.waitFor(app.ID, func(a Artifact) bool {
		return !strings.Contains(a.XML, "<status>pending</status>")
	})
	before := appMadeAtOf(t, landed.XML)
	rig.updateRequest(app.ID, "加个周汇总")
	// 重做失败：pending 消失，旧卡原样回来，made-at 不变。
	back := rig.waitFor(app.ID, func(a Artifact) bool {
		return !strings.Contains(a.XML, "<status>pending</status>")
	})
	if appMadeAtOf(t, back.XML) != before || !strings.Contains(back.XML, "账本") {
		t.Fatalf("redo failure should keep the old card: %s", back.XML)
	}
}

func appMadeAtOf(t *testing.T, xml string) string {
	t.Helper()
	i := strings.Index(xml, "<made-at>")
	j := strings.Index(xml, "</made-at>")
	if i < 0 || j < i {
		t.Fatalf("no made-at in %s", xml)
	}
	return xml[i+len("<made-at>") : j]
}

func TestBridgeArtifactsCleansStaleJobs(t *testing.T) {
	host, _ := appModelHost(t, []string{cleanAppReply(t, "账本")})
	rig := newDeviceRig(t, host)
	old := time.Now().Add(-40 * time.Minute)
	if err := rig.store.insertAppJob(appJobRow{
		ID: "app::2026-01-01:01", User: "", Date: time.Now().Format("2006-01-02"),
		Request: "卡住的", Endpoint: host.URL, Model: "m", Seq: 1, Started: old,
	}); err != nil {
		t.Fatal(err)
	}
	if list := rig.artifacts(); len(list) != 0 {
		t.Fatalf("stale job still projected: %+v", list)
	}
	if jobs, _ := rig.store.appJobRows("", time.Now().Format("2006-01-02")); len(jobs) != 0 {
		t.Fatalf("stale job not cleaned: %+v", jobs)
	}
}

func TestAppJobKeyFromStdin(t *testing.T) {
	key, err := readAppJobKey(strings.NewReader("sk-abc\n"))
	if err != nil || key != "sk-abc" {
		t.Fatalf("key = %q, %v", key, err)
	}
	// 只读第一行，后面的内容不进入密钥。
	if key, err := readAppJobKey(strings.NewReader("line1\nline2\n")); err != nil || key != "line1" {
		t.Fatalf("multi-line stdin key = %q, %v", key, err)
	}
	if _, err := readAppJobKey(strings.NewReader(strings.Repeat("x", 5000) + "\n")); err == nil {
		t.Fatal("oversized key accepted")
	}
}
