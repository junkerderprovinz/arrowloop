package web_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

func TestASettingArrivesInTheFile(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})

	body, _ := json.Marshal(map[string]any{"bwlimit": "2M", "parallelJobs": 3})
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("saving a setting answered %s", resp.Status)
	}

	raw, err := os.ReadFile(h.configPath)
	if err != nil {
		t.Fatalf("read the configuration back: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("the configuration is no longer valid JSON: %v", err)
	}
	if doc["bwlimit"] != "2M" {
		t.Errorf("bwlimit is %v in the file, expected 2M", doc["bwlimit"])
	}
	if doc["parallelJobs"] != float64(3) {
		t.Errorf("parallelJobs is %v in the file, expected 3", doc["parallelJobs"])
	}
}

// The endpoint merges, so an interface of another version cannot drop a key it
// does not know.
func TestAKeyNobodyMentionedSurvives(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})

	send := func(m map[string]any) {
		t.Helper()
		body, _ := json.Marshal(m)
		req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/settings", bytes.NewReader(body))
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("saving answered %s", resp.Status)
		}
	}

	send(map[string]any{"bwlimit": "2M"})
	send(map[string]any{"parallelJobs": 4})

	raw, _ := os.ReadFile(h.configPath)
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if doc["bwlimit"] != "2M" {
		t.Errorf("bwlimit was dropped by a save that never mentioned it: %v", doc["bwlimit"])
	}
}

// An empty string left in the file would override a future default.
func TestAnEmptySettingIsRemovedRatherThanWrittenBlank(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})

	send := func(m map[string]any) {
		t.Helper()
		body, _ := json.Marshal(m)
		req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/settings", bytes.NewReader(body))
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
	}

	send(map[string]any{"bwlimit": "2M"})
	send(map[string]any{"bwlimit": ""})

	raw, _ := os.ReadFile(h.configPath)
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if _, still := doc["bwlimit"]; still {
		t.Errorf("clearing bwlimit left %v in the file rather than removing the key", doc["bwlimit"])
	}
}

// A caller handing back the whole document would otherwise drop a job added in
// another window.
func TestTheJobListCannotBeReplacedThroughHere(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})

	before, _ := os.ReadFile(h.configPath)
	var was map[string]any
	if err := json.Unmarshal(before, &was); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	wasJobs, _ := json.Marshal(was["jobs"])

	body, _ := json.Marshal(map[string]any{"jobs": []any{}, "bwlimit": "1M"})
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/settings", bytes.NewReader(body))
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	after, _ := os.ReadFile(h.configPath)
	var now map[string]any
	if err := json.Unmarshal(after, &now); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	nowJobs, _ := json.Marshal(now["jobs"])
	if string(nowJobs) != string(wasJobs) {
		t.Errorf("the job list changed through the settings endpoint:\n was %s\n now %s", wasJobs, nowJobs)
	}
}

func TestReadingBackGivesTheSettingsAndNotTheJobs(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})

	resp, err := srv.Client().Get(srv.URL + "/api/settings")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var got map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, has := got["jobs"]; has {
		t.Error("the settings came back carrying the whole job list")
	}
}

// allSecrets is a notify block with every secret filled in, each one a word
// that must not appear anywhere it is sent back.
const allSecrets = `{
  "webhook": "https://hooks.example/SECRETHOOK",
  "matrix": {"homeserver": "https://matrix.example.org", "room": "!a:example.org", "token": "SECRETTOKEN"},
  "smtp": {"host": "mail.example.org", "from": "a@example.org", "to": "b@example.org", "username": "arrowloop", "password": "SECRETPASSWORD"},
  "apprise": {"url": "http://apprise:8000/notify/SECRETKEY", "tags": "backups"},
  "healthchecks": {"url": "https://hc-ping.com/SECRETCHECK", "jobs": {"photos": "https://hc-ping.com/SECRETJOBCHECK"}}
}`

var secretWords = []string{"SECRETHOOK", "SECRETTOKEN", "SECRETPASSWORD", "SECRETKEY", "SECRETCHECK", "SECRETJOBCHECK"}

// The Matrix token posts as the account, a mail password logs in, and a
// webhook's, an Apprise server's and a check's address are their own keys, so
// none goes back to the screen, and the placeholder the screen sends back
// keeps them.
func TestTheNotificationSecretsStayOnTheServer(t *testing.T) {
	h := newHarness(t)
	resp, answer := putJSON(t, h.srv, "/api/settings", `{"notify":`+allSecrets+`}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save: %s %s", resp.Status, answer)
	}
	_, read := doJSON(t, h.srv, http.MethodGet, "/api/settings", "")
	for _, secret := range secretWords {
		if strings.Contains(answer, secret) || strings.Contains(read, secret) {
			t.Errorf("the settings carry %s", secret)
		}
	}
	// What is not secret comes back, or the page could not show it.
	for _, plain := range []string{"matrix.example.org", "mail.example.org", "arrowloop", "backups", `"photos"`} {
		if !strings.Contains(read, plain) {
			t.Errorf("the settings lost %s: %s", plain, read)
		}
	}

	// The page saves back what it was given, placeholders and all.
	if resp, body := putJSON(t, h.srv, "/api/settings", read); resp.StatusCode != http.StatusOK {
		t.Fatalf("save the page's copy back: %s %s", resp.Status, body)
	}
	n := h.runner.Config().Notify
	if n.Webhook != "https://hooks.example/SECRETHOOK" || n.Matrix.Token != "SECRETTOKEN" || n.SMTP.Password != "SECRETPASSWORD" ||
		n.Apprise.URL != "http://apprise:8000/notify/SECRETKEY" || n.Healthchecks.URL != "https://hc-ping.com/SECRETCHECK" ||
		n.Healthchecks.Jobs["photos"] != "https://hc-ping.com/SECRETJOBCHECK" {
		t.Errorf("the placeholder replaced what was stored: %+v", n)
	}
}

func TestANewSecretReplacesTheStoredOne(t *testing.T) {
	h := newHarness(t)
	putJSON(t, h.srv, "/api/settings", `{"notify":`+allSecrets+`}`)
	putJSON(t, h.srv, "/api/settings", `{"notify":{"smtp":{"host":"mail.example.org","from":"a@example.org","to":"b@example.org","password":"newpw"},"healthchecks":{"jobs":{"music":"********"}}}}`)
	n := h.runner.Config().Notify
	if n.SMTP.Password != "newpw" {
		t.Errorf("the new password was not stored: %q", n.SMTP.Password)
	}
	// A job that never had a check of its own has nothing to keep.
	if n.Healthchecks.Jobs["music"] != "" {
		t.Errorf("a placeholder became a check: %q", n.Healthchecks.Jobs["music"])
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// Load reads a key whichever case it is spelled in, so the secrets under
// "Notify" and the hooks under "Jobs" are as much the file's as under the
// usual spelling.
func TestSecretsSpelledInAnotherCaseStayOnTheServer(t *testing.T) {
	h := engineFor(t, `{"Notify":{"Webhook":"https://hooks.example/CASEWEBHOOK","Matrix":{"homeserver":"https://m.example","room":"!r:m.example","Token":"syt_CASETOKEN"},`+
		`"SMTP":{"Host":"m.example","From":"a@b.example","To":"c@d.example","Password":"CASEPASSWORD"},"Apprise":{"URL":"http://a.example/notify/CASEKEY"},`+
		`"HealthChecks":{"Url":"https://hc.example/CASECHECK","Jobs":{"photos":"https://hc.example/CASEJOBCHECK"}}},`+
		`"Jobs":[{"name":"photos","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/photos.db","before":"curl -u admin:HOOKSECRET http://nas"}]}`) // gitleaks:allow
	if len(h.runner.Config().Jobs) != 1 {
		t.Fatal("the job under \"Jobs\" was not loaded")
	}
	secrets := []string{"CASEWEBHOOK", "syt_CASETOKEN", "HOOKSECRET", "CASEPASSWORD", "CASEKEY", "CASECHECK", "CASEJOBCHECK"}
	for _, path := range []string{"/api/settings", "/api/diagnostics"} {
		resp, text := doJSON(t, h.srv, http.MethodGet, path, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET %s: %s", path, resp.Status)
		}
		for _, secret := range secrets {
			if strings.Contains(text, secret) {
				t.Errorf("%s carries %s:\n%s", path, secret, text)
			}
		}
	}

	_, settings := doJSON(t, h.srv, http.MethodGet, "/api/settings", "")
	if resp, body := putJSON(t, h.srv, "/api/settings", settings); resp.StatusCode != http.StatusOK {
		t.Fatalf("save the settings back: %s %s", resp.Status, body)
	}
	n := h.runner.Config().Notify
	if n.Webhook != "https://hooks.example/CASEWEBHOOK" || n.Matrix == nil || n.Matrix.Token != "syt_CASETOKEN" ||
		n.SMTP.Password != "CASEPASSWORD" || n.Apprise.URL != "http://a.example/notify/CASEKEY" ||
		n.Healthchecks.URL != "https://hc.example/CASECHECK" || n.Healthchecks.Jobs["photos"] != "https://hc.example/CASEJOBCHECK" {
		t.Errorf("saving the page's copy back replaced the secrets: %+v", n)
	}
}

// The test button sends what the page shows, which holds placeholders where
// the secrets are, so the server fills them in from what it keeps.
func TestATestMessageUsesTheStoredSecret(t *testing.T) {
	h := newHarness(t)
	var got []string
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.URL.Path)
	}))
	defer hook.Close()
	putJSON(t, h.srv, "/api/settings", `{"notify":{"webhook":"`+hook.URL+`/SECRETPATH","webhookFormat":"slack"}}`)

	_, answer := doJSON(t, h.srv, http.MethodPost, "/api/notify/test", `{"channel":"webhook","notify":{"webhook":"********","webhookFormat":"slack"}}`)
	if !strings.Contains(answer, `"ok":true`) || len(got) != 1 || got[0] != "/SECRETPATH" {
		t.Fatalf("the test answered %s and reached %v", answer, got)
	}

	hook.Close()
	_, answer = doJSON(t, h.srv, http.MethodPost, "/api/notify/test", `{"channel":"webhook","notify":{"webhook":"********"}}`)
	if !strings.Contains(answer, `"ok":false`) || !strings.Contains(answer, "reason") {
		t.Errorf("a failed test answered %s", answer)
	}
	if strings.Contains(answer, "SECRETPATH") {
		t.Errorf("the reason carries the address: %s", answer)
	}
}

// A placeholder stands for a secret saved for one server. Whoever changes the
// server beside it has to type the secret, or could have it sent to his own.
func TestASavedSecretIsNotSentToAnotherServer(t *testing.T) {
	h := newHarness(t)
	var reached []string
	stranger := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = append(reached, r.Header.Get("Authorization"))
	}))
	defer stranger.Close()
	putJSON(t, h.srv, "/api/settings", `{"notify":`+allSecrets+`}`)

	_, answer := doJSON(t, h.srv, http.MethodPost, "/api/notify/test",
		`{"channel":"matrix","notify":{"matrix":{"homeserver":"`+stranger.URL+`","room":"!a:example.org","token":"********"}}}`)
	if len(reached) != 0 {
		t.Errorf("the saved token went to another homeserver: %v", reached)
	}
	if !strings.Contains(answer, `"ok":false`) || !strings.Contains(answer, "type it again") {
		t.Errorf("the test answered %s", answer)
	}

	changed := map[string]string{
		"matrix homeserver": `"matrix":{"homeserver":"https://elsewhere.example","room":"!a:example.org","token":"********"}`,
		"mail host":         `"smtp":{"host":"elsewhere.example","from":"a@example.org","to":"b@example.org","username":"arrowloop","password":"********"}`,
		"mail port":         `"smtp":{"host":"mail.example.org","port":2525,"from":"a@example.org","to":"b@example.org","username":"arrowloop","password":"********"}`,
		"mail user":         `"smtp":{"host":"mail.example.org","from":"a@example.org","to":"b@example.org","username":"someone","password":"********"}`,
		"mail encryption":   `"smtp":{"host":"mail.example.org","from":"a@example.org","to":"b@example.org","username":"arrowloop","password":"********","tls":"none"}`,
	}
	for what, channel := range changed {
		resp, body := putJSON(t, h.srv, "/api/settings", `{"notify":{`+channel+`}}`)
		if resp.StatusCode != http.StatusBadRequest || !strings.Contains(body, "type it again") {
			t.Errorf("a changed %s with the placeholder answered %s %s", what, resp.Status, body)
		}
	}
	n := h.runner.Config().Notify
	if n.Matrix.Homeserver != "https://matrix.example.org" || n.SMTP.Host != "mail.example.org" || n.SMTP.Password != "SECRETPASSWORD" {
		t.Errorf("a refused save changed the settings: %+v %+v", n.Matrix, n.SMTP)
	}

	// A new server with the secret typed again is a plain change.
	resp, body := putJSON(t, h.srv, "/api/settings", `{"notify":{"matrix":{"homeserver":"https://elsewhere.example","room":"!a:example.org","token":"NEWTOKEN"}}}`)
	if resp.StatusCode != http.StatusOK || h.runner.Config().Notify.Matrix.Token != "NEWTOKEN" {
		t.Errorf("a new homeserver with its token answered %s %s", resp.Status, body)
	}
}

// The test can be pointed at any address, so what a server there writes back
// must not reach the page.
func TestATestTellsTheStatusButNotWhatTheServerWrote(t *testing.T) {
	h := newHarness(t)
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "INTERNAL ADMIN PAGE", http.StatusForbidden)
	}))
	defer hook.Close()
	_, answer := doJSON(t, h.srv, http.MethodPost, "/api/notify/test", `{"channel":"webhook","notify":{"webhook":"`+hook.URL+`/x"}}`)
	if strings.Contains(answer, "INTERNAL ADMIN PAGE") {
		t.Errorf("the reason carries the server's answer: %s", answer)
	}
	if !strings.Contains(answer, `"ok":false`) || !strings.Contains(answer, "403") {
		t.Errorf("the reason lost the status: %s", answer)
	}
}
