package main

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNormalizeDueOnlyAcceptsResolvedDates(t *testing.T) {
	cases := map[string]string{
		"2026-11-19":                    "2026-11-19",
		" 2026-11-19 ":                  "2026-11-19",
		"2026-11-19..2026-11-25":        "2026-11-19..2026-11-25",
		"2026-11-25..2026-11-19":        "", // 起止颠倒
		"下周四":                           "",
		"11月19日":                        "",
		"2026-11-19..":                  "",
		"..2026-11-19":                  "",
		"":                              "",
		"2026-11-19..2026-11-25..extra": "", // 多段
	}
	for in, want := range cases {
		if got := normalizeDue(in); got != want {
			t.Fatalf("normalizeDue(%q)=%q want %q", in, got, want)
		}
	}
}

func dailyVoiceStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore(filepath.Join(t.TempDir(), "daily-voice.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// 有凭据才说话：确认过、带明确日子的记忆到期，tick 说一句并带原话。
func TestDailyVoiceSpeaksOnlyWithConfirmedDue(t *testing.T) {
	s := dailyVoiceStore(t)
	user, _ := storeUser(t, s)
	note := "我妈让我周四之前给舅舅打电话说祝寿。"
	src, err := s.ImportFrom(user, "self", "手记", "给舅舅打电话", note, []Finding{})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AddReadings(user, src.ID, []Finding{{Text: "周四前给舅舅打电话说祝寿。", Quote: "我妈让我周四之前给舅舅打电话说祝寿。", Date: time.Now().Format("2006-01-02")}}); err != nil {
		t.Fatal(err)
	}
	// 未确认：没凭据开口，沉默。
	if made, err := s.RunAgentTickForUser(user, time.Now()); err != nil || made != 0 {
		t.Fatalf("unconfirmed tick made=%d err=%v", made, err)
	}
	memories, err := s.Portrait(user)
	if err != nil || len(memories) != 1 {
		t.Fatalf("portrait=%v err=%v", memories, err)
	}
	if memories[0].Due != time.Now().Format("2006-01-02") {
		t.Fatalf("due=%q", memories[0].Due)
	}
	if _, err := s.Correct(user, memories[0].ID, "周四前给舅舅打电话说祝寿。", memories[0].Version); err != nil {
		t.Fatal(err)
	}
	made, err := s.RunAgentTickForUser(user, time.Now())
	if err != nil || made != 1 {
		t.Fatalf("tick made=%d err=%v", made, err)
	}
	cards, err := s.Artifacts(user, time.Now().Format("2006-01-02"))
	if err != nil {
		t.Fatal(err)
	}
	var voice string
	for _, c := range cards {
		if c.Type == "voice" {
			voice = c.XML
		}
	}
	if !strings.Contains(voice, "我妈让我周四之前给舅舅打电话说祝寿。") {
		t.Fatalf("voice card misses verbatim quote: %s", voice)
	}
	if !strings.Contains(voice, "<badge>今天</badge>") {
		t.Fatalf("voice card badge: %s", voice)
	}
	// 同一天幂等：再 tick 不加卡。
	if made, err := s.RunAgentTickForUser(user, time.Now()); err != nil || made != 0 {
		t.Fatalf("second tick made=%d err=%v", made, err)
	}
}

// 过期还没办的挑最早一条；没带日子的记忆不触发说话。
func TestDailyVoiceOverdueAndSilence(t *testing.T) {
	s := dailyVoiceStore(t)
	user, _ := storeUser(t, s)
	today := time.Now()
	yesterday := today.AddDate(0, 0, -1).Format("2006-01-02")
	twoDaysAgo := today.AddDate(0, 0, -2).Format("2006-01-02")
	body := "周三前交房租。周二取体检报告。"
	src, err := s.ImportFrom(user, "self", "手记", "待办", body, []Finding{})
	if err != nil {
		t.Fatal(err)
	}
	findings := []Finding{
		{Text: "周三前交房租。", Quote: "周三前交房租。", Date: yesterday},
		{Text: "周二取体检报告。", Quote: "周二取体检报告。", Date: twoDaysAgo},
	}
	if err := s.AddReadings(user, src.ID, findings); err != nil {
		t.Fatal(err)
	}
	// 一条不带日子的，确认了也不说话。
	src2, err := s.ImportFrom(user, "self", "手记", "别的", "水电单价要问清楚。", []Finding{})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AddReadings(user, src2.ID, []Finding{{Text: "水电单价要问清楚。", Quote: "水电单价要问清楚。"}}); err != nil {
		t.Fatal(err)
	}
	memories, err := s.Portrait(user)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range memories {
		if _, err := s.Correct(user, m.ID, m.Text, m.Version); err != nil {
			t.Fatal(err)
		}
	}
	if made, err := s.RunAgentTickForUser(user, today); err != nil || made != 1 {
		t.Fatalf("tick made=%d err=%v", made, err)
	}
	cards, err := s.Artifacts(user, today.Format("2006-01-02"))
	if err != nil {
		t.Fatal(err)
	}
	var voice string
	for _, c := range cards {
		if c.Type == "voice" {
			voice = c.XML
		}
	}
	if !strings.Contains(voice, "周二取体检报告。") {
		t.Fatalf("earliest overdue not picked: %s", voice)
	}
	if !strings.Contains(voice, "<badge>还没办</badge>") {
		t.Fatalf("overdue badge: %s", voice)
	}
}
