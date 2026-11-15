package main

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

// 真模型端到端（平时跳过，防 CI 花钱）：
//
//	ONIT_REAL_MODEL_ENDPOINT=http://127.0.0.1:3425/v1/chat/completions \
//	ONIT_REAL_MODEL_NAME=xai/grok-4.6 go test -run TestRealModelMiniApp -v .
func TestRealModelMiniApp(t *testing.T) {
	endpoint := os.Getenv("ONIT_REAL_MODEL_ENDPOINT")
	name := os.Getenv("ONIT_REAL_MODEL_NAME")
	if endpoint == "" || name == "" {
		t.Skip("real model endpoint not configured")
	}
	requests := []string{
		"帮我做个旅行基金小应用，目标 5000，已经存了 1200。",
		"帮我做个喝水打卡，一天八杯。",
	}
	for i, req := range requests {
		app, attempts, err := MakeMiniApp(context.Background(), nil, endpoint, name, os.Getenv("ONIT_REAL_MODEL_KEY"), req, time.Now())
		if err != nil {
			t.Fatalf("%s: %v", req, err)
		}
		t.Logf("request=%q attempts=%d degraded=%v title=%q purpose=%q", req, attempts, app.Degraded, app.Title, app.Purpose)
		if !app.Degraded {
			if err := validateMiniApp(app); err != nil {
				t.Fatalf("%s: stored app fails guardrails: %v", req, err)
			}
			if !strings.Contains(app.HTML, "store") {
				t.Fatalf("%s: app does not use the injected store: %s", req, app.HTML)
			}
			t.Logf("html:\n%s", app.HTML)
		}
		if dump := os.Getenv("ONIT_REAL_DUMP"); dump != "" {
			xml := "<app><title>" + xmlEscape(app.Title) + "</title><purpose>" + xmlEscape(app.Purpose) +
				"</purpose><request>" + xmlEscape(req) + "</request><html>" + xmlEscape(app.HTML) +
				"</html><made-at>" + time.Now().UTC().Format(time.RFC3339) + "</made-at><degraded>0</degraded></app>"
			if err := os.WriteFile(dump+"/app-"+string(rune('0'+i))+".xml", []byte(xml), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
}
