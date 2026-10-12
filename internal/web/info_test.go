package web_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

func runningVersion(t *testing.T, v string) {
	t.Helper()
	was := boot.Version
	boot.Version = v
	t.Cleanup(func() { boot.Version = was })
}

func TestTheVersionsNameTheBuildAndTheRcloneItCarries(t *testing.T) {
	runningVersion(t, "v1.8.0")
	h := newHarness(t)
	var got struct {
		ArrowLoop string `json:"arrowloop"`
		Rclone    string `json:"rclone"`
	}
	h.get(t, "/api/versions", &got)
	if got.ArrowLoop != "v1.8.0" {
		t.Errorf("arrowloop = %q, want v1.8.0", got.ArrowLoop)
	}
	if !strings.HasPrefix(got.Rclone, "v1.") || strings.Contains(got.Rclone, "DEV") {
		t.Errorf("rclone = %q, want a plain release tag", got.Rclone)
	}
}

// fakeGitHub answers the latest-release question with the given status and body.
func fakeGitHub(t *testing.T, status int, header http.Header, body string) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/junkerderprovinz/arrowloop/releases/latest" {
			http.NotFound(w, r)
			return
		}
		for k, v := range header {
			w.Header()[k] = v
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func checkUpdate(t *testing.T, releases string) (int, map[string]any) {
	t.Helper()
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, Releases: releases})
	resp, err := srv.Client().Post(srv.URL+"/api/update-check", "application/json", nil)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	var got map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return resp.StatusCode, got
}

func TestANewerReleaseIsReportedWithItsPage(t *testing.T) {
	runningVersion(t, "v1.8.0")
	status, got := checkUpdate(t, fakeGitHub(t, http.StatusOK, nil, `{"tag_name":"v1.10.0"}`))
	if status != http.StatusOK {
		t.Fatalf("status %d: %v", status, got)
	}
	if got["updateAvailable"] != true || got["latest"] != "v1.10.0" {
		t.Errorf("got %v, want v1.10.0 as an update", got)
	}
	if got["releaseUrl"] != "https://github.com/junkerderprovinz/arrowloop/releases/tag/v1.10.0" {
		t.Errorf("releaseUrl = %v", got["releaseUrl"])
	}
}

func TestTheSameReleaseIsUpToDate(t *testing.T) {
	runningVersion(t, "v1.8.0")
	_, got := checkUpdate(t, fakeGitHub(t, http.StatusOK, nil, `{"tag_name":"v1.8.0"}`))
	if got["updateAvailable"] != false {
		t.Errorf("got %v, want no update", got)
	}
}

func TestAnUpdateCheckThatCannotRunSaysWhy(t *testing.T) {
	limited := http.Header{"X-Ratelimit-Remaining": {"0"}}
	for _, c := range []struct {
		name     string
		running  string
		releases string
		want     string
	}{
		{"a local build", "dev", fakeGitHub(t, http.StatusOK, nil, `{"tag_name":"v1.9.0"}`), "dev-build"},
		{"a rate limit", "v1.8.0", fakeGitHub(t, http.StatusForbidden, limited, `{}`), "rate-limited"},
		{"a tag that is no version", "v1.8.0", fakeGitHub(t, http.StatusOK, nil, `{"tag_name":"nightly"}`), "bad-response"},
		{"no answer", "v1.8.0", "http://127.0.0.1:1", "offline"},
	} {
		t.Run(c.name, func(t *testing.T) {
			runningVersion(t, c.running)
			status, got := checkUpdate(t, c.releases)
			if status == http.StatusOK || got["code"] != c.want {
				t.Errorf("status %d, body %v; want a refusal coded %q", status, got, c.want)
			}
		})
	}
}

func TestTheBugReportCarriesNoSecret(t *testing.T) {
	h := newHarness(t)
	settings := `{"notify":{"webhook":"https://hooks.example/abc123secret","matrix":{"homeserver":"https://m.example","room":"!r:m.example","token":"syt_tokensecret"}}}`
	if resp, body := putJSON(t, h.srv, "/api/settings", settings); resp.StatusCode != http.StatusOK {
		t.Fatalf("save settings: %s %s", resp.Status, body)
	}
	err := h.history.Record(context.Background(), history.Run{Job: "photos", Err: "the target refused the upload"}, nil)
	if err != nil {
		t.Fatalf("record a run: %v", err)
	}

	resp, err := h.srv.Client().Get(h.srv.URL + "/api/diagnostics")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %s", resp.Status)
	}
	if got := resp.Header.Get("Content-Disposition"); !strings.HasPrefix(got, "attachment;") {
		t.Errorf("Content-Disposition = %q, want an attachment", got)
	}
	var raw json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	text := string(raw)
	for _, secret := range []string{"abc123secret", "syt_tokensecret"} {
		if strings.Contains(text, secret) {
			t.Errorf("the report carries %q", secret)
		}
	}
	for _, wanted := range []string{"the target refused the upload", `"photos"`, `"rclone"`} {
		if !strings.Contains(text, wanted) {
			t.Errorf("the report lacks %s", wanted)
		}
	}
}
