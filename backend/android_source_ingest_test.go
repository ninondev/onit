package main

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestAndroidSourceAddRequiresWorld(t *testing.T) {
	s, err := OpenStore(filepath.Join(t.TempDir(), "private.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, err = s.androidRequest([]byte(encode(object{"op": "source-add", "kind": "notification",
		"origin": "微信", "title": "账单提醒", "text": "本月账单 1200 元"})))
	var business bridgeError
	if !errors.As(err, &business) || business.code != "empty_world" {
		t.Fatal(err)
	}
}

func TestAndroidSourceAddAndList(t *testing.T) {
	s, err := OpenStore(filepath.Join(t.TempDir(), "private.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	world, err := parseObject([]byte(mobileFixture))
	if err != nil {
		t.Fatal(err)
	}
	bridgeRequest(t, s, object{"op": "write", "revision": 0, "state": world})

	before := bridgeRequest(t, s, object{"op": "read"})["revision"]
	add := object{"op": "source-add", "kind": "notification",
		"origin": "招商银行", "title": "还款提醒", "text": "您的信用卡11月14日到期还款1840元。"}
	first := bridgeRequest(t, s, add)
	if first["ok"] != true || first["source"] == nil {
		t.Fatal(first)
	}
	after := bridgeRequest(t, s, object{"op": "read"})["revision"]
	if number(after) <= number(before) {
		t.Fatal("revision should advance", before, after)
	}

	// 同一份材料重复送来：sources 表有唯一约束，幂等返回已有行，不新增。
	second := bridgeRequest(t, s, add)
	if second["ok"] != true || second["duplicate"] != true || second["source"] == nil {
		t.Fatal(second)
	}

	list := bridgeRequest(t, s, object{"op": "sources"})
	rows, ok := list["sources"].([]object)
	if !ok || len(rows) != 2 { // fixture 自带 1 条 + 新增 1 条（重复不另起一行）
		t.Fatal(len(rows))
	}
	found := false
	for _, row := range rows {
		if row["kind"] == "notification" && row["origin"] == "招商银行" && row["title"] == "还款提醒" {
			found = true
		}
	}
	if !found {
		t.Fatal(rows)
	}

	// 写回的世界里必须真的有这条来源，且原字段不被破坏。
	read := bridgeRequest(t, s, object{"op": "read"})
	state, _ := read["state"].(object)
	srcs, err := objects(state["sources"])
	if err != nil || len(srcs) != 2 {
		t.Fatal(err, len(srcs))
	}
	if str(srcs[0], "id") != "s" {
		t.Fatal("fixture source damaged")
	}

	for _, kind := range []string{"photo", "notification", "calendar"} {
		if r := bridgeRequest(t, s, object{"op": "source-add", "kind": kind,
			"origin": "相册", "title": "t", "text": "x"}); r["ok"] != true {
			t.Fatal(kind, r)
		}
	}
	if _, err := s.androidRequest([]byte(encode(object{"op": "source-add", "kind": "sms",
		"origin": "o", "title": "t", "text": "x"}))); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if _, err := s.androidRequest([]byte(encode(object{"op": "source-add", "kind": "notification",
		"origin": "o", "title": "", "text": "x"}))); !errors.Is(err, ErrInvalid) {
		t.Fatal("empty title accepted")
	}
}
