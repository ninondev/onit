package main

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 页面 live 模式（?live=1）的完整链路：agent tick 写当日 voice
// artifact，GET /v1/artifacts 读回卡，POST /v1/voice-act 三动作按
// token 主人落库。
func TestHTTPVoiceActRoundTrip(t *testing.T) {
	today := time.Now().Format("2006-01-02")
	db, err := OpenStore(filepath.Join(t.TempDir(), "voice-http.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server := httptest.NewServer(newService(db, Model{}))
	defer server.Close()
	user, token := storeUser(t, db)

	mustExec(t, db, `INSERT INTO sources(user_id,id,kind,origin,title,body,digest) VALUES (?,'src1','self','手记','电费','电费单来了,11月20号前缴,大概 180 块。',X'00')`, user)
	mustExec(t, db, `INSERT INTO memories(id,user_id,source_id,current_text,quote,start_byte,end_byte,confirmed,due,version)
		VALUES ('mem1',?,'src1','电费 180，20 号前缴。','电费单来了,11月20号前缴,大概 180 块。',0,52,1,?,1)`, user, today)

	// 一轮 agent tick 写出当日 voice artifact。
	apiCall(t, server.URL, token, "POST", "/v1/agent/tick", map[string]any{}, 200)

	// 页面 live 拉的就是这个清单。
	data := apiCall(t, server.URL, token, "GET", "/v1/artifacts/"+today, nil, 200)
	var listed struct {
		Artifacts []Artifact `json:"artifacts"`
	}
	if err := json.Unmarshal(data, &listed); err != nil {
		t.Fatal(err)
	}
	var voiceXML string
	for _, a := range listed.Artifacts {
		if a.Type == "voice" {
			voiceXML = a.XML
		}
	}
	if voiceXML == "" || !strings.Contains(voiceXML, "电费 180") || !strings.Contains(voiceXML, "mem1") {
		t.Fatalf("voice artifact missing or wrong: %q", voiceXML)
	}

	// 猜对了：幂等确认。
	okReply := apiCall(t, server.URL, token, "POST", "/v1/voice-act",
		map[string]string{"memoryId": "mem1", "action": "confirm"}, 200)
	if !strings.Contains(string(okReply), `"ok":true`) {
		t.Fatalf("confirm reply: %s", okReply)
	}

	// 改写：文本更新、版本前进。
	rwReply := apiCall(t, server.URL, token, "POST", "/v1/voice-act",
		map[string]string{"memoryId": "mem1", "action": "rewrite", "text": "电费 180，19 号就去缴。"}, 200)
	if !strings.Contains(string(rwReply), "电费 180，19 号就去缴。") {
		t.Fatalf("rewrite reply keeps old text: %s", rwReply)
	}

	// 忘掉：forgotten。
	dropReply := apiCall(t, server.URL, token, "POST", "/v1/voice-act",
		map[string]string{"memoryId": "mem1", "action": "drop"}, 200)
	if !strings.Contains(string(dropReply), `"forgotten":true`) {
		t.Fatalf("drop reply: %s", dropReply)
	}

	// 空 memoryId 与未知动作都拒。
	apiCall(t, server.URL, token, "POST", "/v1/voice-act",
		map[string]string{"action": "confirm"}, 400)
	apiCall(t, server.URL, token, "POST", "/v1/voice-act",
		map[string]string{"memoryId": "mem1", "action": "explode"}, 400)

	// 别的 token 摸不到这条记忆。
	_, other := storeUser(t, db)
	apiCall(t, server.URL, other, "POST", "/v1/voice-act",
		map[string]string{"memoryId": "mem1", "action": "confirm"}, 404)
}
