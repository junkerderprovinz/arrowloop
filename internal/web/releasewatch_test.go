package web_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// countingGitHub answers every latest-release question with tag and counts them.
func countingGitHub(t *testing.T, tag string, asked *atomic.Int32) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/junkerderprovinz/arrowloop/releases/latest" {
			http.NotFound(w, r)
			return
		}
		asked.Add(1)
		_, _ = w.Write([]byte(`{"tag_name":"` + tag + `"}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func watching(t *testing.T, releases string) *httptest.Server {
	t.Helper()
	h := newHarness(t)
	s := &web.Server{History: h.history, Runner: h.runner, Releases: releases, ReleaseLook: 5 * time.Millisecond, Deployment: "container"}
	srv := newServer(t, s)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go s.WatchReleases(ctx)
	return srv
}

func newRelease(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	var got struct {
		NewRelease string `json:"newRelease"`
	}
	getJSON(t, srv, "/api/versions", &got)
	return got.NewRelease
}

func TestTheDailyUpdateCheckAsksNothingWhileItsSwitchIsOff(t *testing.T) {
	runningVersion(t, "v1.8.0")
	var asked atomic.Int32
	srv := watching(t, countingGitHub(t, "v1.10.0", &asked))

	time.Sleep(60 * time.Millisecond)
	if n := asked.Load(); n != 0 {
		t.Errorf("GitHub was asked %d times with the switch off", n)
	}
	if got := newRelease(t, srv); got != "" {
		t.Errorf("newRelease = %q with the switch off, want none", got)
	}
}

func TestTheDailyUpdateCheckReportsANewerReleaseOnceADay(t *testing.T) {
	runningVersion(t, "v1.8.0")
	var asked atomic.Int32
	srv := watching(t, countingGitHub(t, "v1.10.0", &asked))

	if resp, body := putJSON(t, srv, "/api/settings", `{"updateCheck":true}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("turning the switch on answered %s: %s", resp.Status, body)
	}
	deadline := time.Now().Add(5 * time.Second)
	for newRelease(t, srv) == "" {
		if time.Now().After(deadline) {
			t.Fatal("the newer release was never reported")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if got := newRelease(t, srv); got != "v1.10.0" {
		t.Errorf("newRelease = %q, want v1.10.0", got)
	}

	time.Sleep(60 * time.Millisecond)
	if n := asked.Load(); n != 1 {
		t.Errorf("GitHub was asked %d times within the day, want once", n)
	}
}

func TestTheDailyUpdateCheckReportsNothingWhileTheBuildIsCurrent(t *testing.T) {
	runningVersion(t, "v1.10.0")
	var asked atomic.Int32
	srv := watching(t, countingGitHub(t, "v1.10.0", &asked))

	putJSON(t, srv, "/api/settings", `{"updateCheck":true}`)
	deadline := time.Now().Add(5 * time.Second)
	for asked.Load() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("GitHub was never asked")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if got := newRelease(t, srv); got != "" {
		t.Errorf("newRelease = %q for the running release, want none", got)
	}
}
