package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func mustExec(t *testing.T, s *Store, query string, args ...any) {
	t.Helper()
	if _, err := s.db.Exec(query, args...); err != nil {
		t.Fatalf("exec %s: %v", query, err)
	}
}

// 桥是单主人库：users(”) + 一条确认过、带 due 的记忆，走真实
// androidRequest 路径验证 tick 附卡与通知栏三动作。
func seedBridgeVoice(t *testing.T, due string) (*Store, string) {
	t.Helper()
	s, err := OpenStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	mustExec(t, s, `INSERT INTO users VALUES ('',X'01')`)
	mustExec(t, s, `INSERT INTO sources(user_id,id,kind,origin,title,body,digest) VALUES ('','src1','self','手记','电费','电费单来了,11月20号前缴,大概 180 块。',X'00')`)
	mustExec(t, s, `INSERT INTO memories(id,user_id,source_id,current_text,quote,start_byte,end_byte,confirmed,due,version)
		VALUES ('mem1','','src1','电费 180，20 号前缴。','电费单来了,11月20号前缴,大概 180 块。',0,52,1,?,1)`, due)
	return s, "mem1"
}

func bridgeCall(t *testing.T, s *Store, body object) object {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	reply, err := s.androidRequest(raw)
	if err != nil {
		t.Fatalf("%s: %v", body["op"], err)
	}
	return reply
}

func TestBridgeTickAttachesDailyVoice(t *testing.T) {
	today := time.Now().Format("2006-01-02")
	s, memID := seedBridgeVoice(t, today)
	reply := bridgeCall(t, s, object{"op": "tick", "source": "background"})
	voice, ok := reply["voice"].(object)
	if !ok {
		t.Fatalf("tick reply has no voice: %v", reply)
	}
	if voice["message"] != "电费 180，20 号前缴。" || voice["memoryId"] != memID || voice["badge"] != "今天" {
		t.Fatalf("voice card wrong: %v", voice)
	}
	if voice["due"] != today {
		t.Fatalf("voice due: %v", voice["due"])
	}
	// 同日幂等：第二次 tick 仍然同一张、同一记忆。
	again := bridgeCall(t, s, object{"op": "tick", "source": "foreground"})
	v2, ok := again["voice"].(object)
	if !ok || v2["memoryId"] != memID {
		t.Fatalf("second tick voice: %v", again["voice"])
	}
}

func TestBridgeTickSilentWithoutDue(t *testing.T) {
	s, _ := seedBridgeVoice(t, "") // 无 due：不该有卡
	reply := bridgeCall(t, s, object{"op": "tick", "source": "background"})
	if _, ok := reply["voice"]; ok {
		t.Fatalf("voice should be silent: %v", reply["voice"])
	}
}

func TestBridgeVoiceActConfirmRewriteDrop(t *testing.T) {
	today := time.Now().Format("2006-01-02")
	s, memID := seedBridgeVoice(t, today)

	// 猜对了：已确认的记忆上是幂等无操作，字与版本都不动。
	reply := bridgeCall(t, s, object{"op": "voice-act", "memoryId": memID, "action": "confirm"})
	mem, ok := reply["memory"].(Memory)
	if !ok {
		t.Fatalf("confirm reply: %v", reply)
	}
	if !mem.Confirmed || mem.Text != "电费 180，20 号前缴。" || mem.Version != 1 {
		t.Fatalf("confirm result: %+v", mem)
	}

	// 改写：新字进正题，确认保持，版本前进到 2。
	reply = bridgeCall(t, s, object{"op": "voice-act", "memoryId": memID, "action": "rewrite", "text": "电费 180，19 号就缴。"})
	mem, ok = reply["memory"].(Memory)
	if !ok {
		t.Fatalf("rewrite reply: %v", reply)
	}
	if mem.Text != "电费 180，19 号就缴。" || !mem.Confirmed || mem.Version != 2 {
		t.Fatalf("rewrite result: %+v", mem)
	}

	// 空文本改写被拒。
	if _, err := s.androidRequest(mustRaw(t, object{"op": "voice-act", "memoryId": memID, "action": "rewrite", "text": " "})); err == nil {
		t.Fatal("blank rewrite accepted")
	}

	// 忘掉：记忆消失，dismissed 留档，同一段原文不会再被复读。
	if reply := bridgeCall(t, s, object{"op": "voice-act", "memoryId": memID, "action": "drop"}); reply["forgotten"] != true {
		t.Fatalf("drop reply: %v", reply)
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM memories WHERE id=?`, memID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("memory still present: %d %v", n, err)
	}
	var dismissed int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM dismissed WHERE user_id='' AND source_id='src1'`).Scan(&dismissed); err != nil || dismissed == 0 {
		t.Fatalf("dismissed spans missing: %d %v", dismissed, err)
	}
}

func TestBridgeVoiceCardCarriesMemoryIDInXML(t *testing.T) {
	today := time.Now().Format("2006-01-02")
	s, _ := seedBridgeVoice(t, today)
	bridgeCall(t, s, object{"op": "tick", "source": "background"})
	rows, err := s.Artifacts("", today)
	if err != nil || len(rows) == 0 {
		t.Fatalf("artifacts: %v %v", rows, err)
	}
	if !strings.Contains(rows[0].XML, "<memory-id>") {
		t.Fatalf("card missing memory-id: %s", rows[0].XML)
	}
}

func mustRaw(t *testing.T, o object) []byte {
	t.Helper()
	raw, err := json.Marshal(o)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
