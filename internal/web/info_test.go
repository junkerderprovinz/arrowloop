package web_test

import (
	"context"
	"encoding/json"
	"io"
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

func TestTheReleaseNotesEndAtTheRunningRelease(t *testing.T) {
	runningVersion(t, "v1.2.0")
	h := newHarness(t)
	var got struct {
		Notes []struct {
			Version string `json:"version"`
			Body    string `json:"body"`
		} `json:"notes"`
	}
	h.get(t, "/api/release-notes", &got)
	if len(got.Notes) != 3 || got.Notes[0].Version != "v1.2.0" || got.Notes[2].Version != "v1.0.0" {
		t.Fatalf("notes = %+v, want v1.2.0, v1.1.0 and v1.0.0", got.Notes)
	}
	if got.Notes[0].Body == "" {
		t.Error("the notes of v1.2.0 are empty")
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

func bugReport(t *testing.T, h *harness) string {
	t.Helper()
	resp, err := h.srv.Client().Get(h.srv.URL + "/api/diagnostics")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %s", resp.Status)
	}
	var buf strings.Builder
	if _, err := io.Copy(&buf, resp.Body); err != nil {
		t.Fatalf("read: %v", err)
	}
	return buf.String()
}

func TestTheBugReportLeavesOutTheConnectionStringARunFailedOn(t *testing.T) {
	h := engineFor(t, `{"anomalies":{"failingAfter":1},"jobs":[{"name":"photos","left":"%[1]s/left",`+
		`"right":":sftp,host=127.0.0.1,port=1,user=bob,pass=TOPSECRETPASS:/x","state":"%[1]s/photos.db"}]}`)
	if _, err := h.runner.Run(context.Background(), "photos"); err == nil || !strings.Contains(err.Error(), "TOPSECRETPASS") {
		t.Fatalf("the run should fail naming its side, got %v", err)
	}
	text := bugReport(t, h)
	if strings.Contains(text, "TOPSECRETPASS") || strings.Contains(text, "user=bob") {
		t.Errorf("the report carries the connection string's parameters:\n%s", text)
	}
	if !strings.Contains(text, `:sftp:/x`) {
		t.Errorf("the report lost which side failed:\n%s", text)
	}
}

func TestTheBugReportLeavesOutWhatAHookPrinted(t *testing.T) {
	h := engineFor(t, `{"jobs":[{"name":"photos","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/photos.db",`+
		`"before":"echo HOOKSECRET && exit 3"}]}`)
	if _, err := h.runner.Run(context.Background(), "photos"); err == nil || !strings.Contains(err.Error(), "HOOKSECRET") {
		t.Fatalf("the run should fail with the command's output, got %v", err)
	}
	text := bugReport(t, h)
	if strings.Contains(text, "HOOKSECRET") {
		t.Errorf("the report carries the command's output:\n%s", text)
	}
	if !strings.Contains(text, "exit status 3") {
		t.Errorf("the report lost how the command ended:\n%s", text)
	}
}

func TestTheBugReportCountsAFindingsFilesWithoutNamingThem(t *testing.T) {
	h := newHarness(t)
	heldJob(t, h)
	var got struct {
		Findings []map[string]any `json:"findings"`
	}
	if err := json.Unmarshal([]byte(bugReport(t, h)), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Findings) != 1 {
		t.Fatalf("findings = %v, want the one brake", got.Findings)
	}
	f := got.Findings[0]
	if _, named := f["paths"]; named {
		t.Errorf("the finding names its files: %v", f["paths"])
	}
	if f["files"] != float64(30) {
		t.Errorf("files = %v, want 30", f["files"])
	}
}

func TestTheBugReportShowsAHomeFolderAsATilde(t *testing.T) {
	h := engineFor(t, `{"excludeSets":{"private":["/home/anna/Tagebuch/**"]},`+
		`"jobs":[{"name":"photos","left":"C:/Users/Anna Berger/Pictures","right":"/Users/anna/Fotos","state":"%[1]s/photos.db"}]}`)
	// Set over the API, since the engine would open a run log at this path
	// if it started with it.
	if resp, body := putJSON(t, h.srv, "/api/settings", `{"history":"/home/anna/arrowloop/history.db"}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("save settings: %s %s", resp.Status, body)
	}
	text := bugReport(t, h)
	if strings.Contains(text, "anna") || strings.Contains(text, "Anna Berger") {
		t.Errorf("the report names the person:\n%s", text)
	}
	for _, want := range []string{`"~/Pictures"`, `"~/Fotos"`, `"~/arrowloop/history.db"`, `"~/Tagebuch/**"`} {
		if !strings.Contains(text, want) {
			t.Errorf("the report lacks %s:\n%s", want, text)
		}
	}
}

// The report goes into a public issue, where a mail address, a mail server or
// a Matrix room names the person as well as a password would.
func TestTheBugReportNamesNoAddress(t *testing.T) {
	h := newHarness(t)
	settings := `{"notify":{"matrix":{"homeserver":"https://matrix.anna-berger.example","room":"!annasroom:anna-berger.example","token":"t"},` +
		`"smtp":{"host":"mail.anna-berger.example","port":587,"username":"anna.berger","from":"arrowloop@anna-berger.example","to":"anna@berger.example","password":"p"}}}`
	if resp, body := putJSON(t, h.srv, "/api/settings", settings); resp.StatusCode != http.StatusOK {
		t.Fatalf("save settings: %s %s", resp.Status, body)
	}
	text := bugReport(t, h)
	for _, address := range []string{"anna", "berger"} {
		if strings.Contains(strings.ToLower(text), address) {
			t.Errorf("the report carries %q:\n%s", address, text)
		}
	}
	var got struct {
		Settings struct {
			Notify struct {
				Matrix map[string]any `json:"matrix"`
				SMTP   map[string]any `json:"smtp"`
			} `json:"notify"`
		} `json:"settings"`
	}
	if err := json.Unmarshal([]byte(text), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Settings.Notify.Matrix["room"] != "set" || got.Settings.Notify.SMTP["to"] != "set" || got.Settings.Notify.SMTP["port"] != float64(587) {
		t.Errorf("the report lost which settings are filled in: %+v", got.Settings.Notify)
	}
}
