package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"
)

// 桥的来源收录：通知、相册、日历三类外部材料从原生侧进入状态世界。
// 与 HTTP 的 importMaterial 不同，安卓侧只有一个用户，材料直接落在
// android_dossier 的 sources 里，供目标复盘挑选、材料简报引用。
// 世界还不存在（首次使用未完成）时拒绝收录，不替用户开局。

var androidIngestKinds = map[string]bool{"notification": true, "photo": true, "calendar": true}

func (s *Store) androidSourceAdd(kind, origin, title, text string) (object, error) {
	if !androidIngestKinds[kind] || title == "" || text == "" {
		return nil, ErrInvalid
	}
	if !bounded(origin, 140) || !bounded(title, 140) || !bounded(text, 120000) {
		return nil, ErrInvalid
	}
	id, err := newAndroidSourceID()
	if err != nil {
		return nil, err
	}
	source := object{
		"id": id, "kind": kind, "origin": origin,
		"title": title, "text": text,
		"version": 1, "at": time.Now().Format(time.RFC3339),
	}
	for attempt := 0; attempt < 3; attempt++ {
		current, err := s.androidState(nil, nil, "")
		if err != nil {
			return nil, err
		}
		state, _ := current["state"].(object)
		if state == nil {
			return nil, bridgeError{"empty_world"}
		}
		rows, err := objects(state["sources"])
		if err != nil {
			return nil, err
		}
		// sources 表对 (kind,origin,title,digest) 有唯一约束：同一份材料
		// 只算一条来源。重复送来时幂等返回已有行，不推进版本。
		for _, row := range rows {
			if str(row, "kind") == kind && str(row, "origin") == origin &&
				str(row, "title") == title && str(row, "text") == text {
				return object{"ok": true, "source": row, "duplicate": true,
					"revision": current["revision"], "snapshot": current["snapshot"]}, nil
			}
		}
		// splitDossier 只认 []any（JSON 反序列化的形状），不能塞 []object。
		list, ok := state["sources"].([]any)
		if !ok {
			list = make([]any, 0, len(rows)+1)
			for _, row := range rows {
				list = append(list, row)
			}
		}
		state["sources"] = append(list, source)
		revision := int(number(current["revision"]))
		out, err := s.androidState(&revision, state, str(current, "snapshot"))
		if err == nil {
			out["source"] = source
			return out, nil
		}
		if !errors.Is(err, ErrConflict) {
			return nil, err
		}
	}
	return nil, ErrConflict
}

func (s *Store) androidSources() (object, error) {
	current, err := s.androidState(nil, nil, "")
	if err != nil {
		return nil, err
	}
	rows := []object{}
	state, _ := current["state"].(object)
	if state != nil {
		list, err := objects(state["sources"])
		if err != nil {
			return nil, err
		}
		for _, src := range list {
			rows = append(rows, object{
				"id": str(src, "id"), "kind": str(src, "kind"), "origin": str(src, "origin"),
				"title": str(src, "title"), "at": str(src, "at"),
			})
		}
	}
	return object{"ok": true, "sources": rows}, nil
}

func newAndroidSourceID() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "as-" + hex.EncodeToString(buf), nil
}
