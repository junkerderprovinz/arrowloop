package web_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

// allSecrets is a channel list with a secret of every kind, each one a word
// that must not appear anywhere it is sent back.
const allSecrets = `{"channels": [
  {"id": "hook", "kind": "webhook", "enabled": true, "webhook": {"url": "https://hooks.example/SECRETHOOK", "headers": {"Authorization": "Bearer SECRETHEADER"}}},
  {"id": "room", "kind": "matrix", "enabled": true, "matrix": {"homeserver": "https://matrix.example.org", "room": "!a:example.org", "token": "SECRETTOKEN"}},
  {"id": "mail", "kind": "smtp", "enabled": true, "smtp": {"host": "mail.example.org", "from": "a@example.org", "to": "b@example.org", "username": "arrowloop", "password": "SECRETPASSWORD"}},
  {"id": "apprise", "kind": "apprise", "enabled": true, "apprise": {"url": "http://apprise:8000/notify/SECRETKEY", "tags": "backups"}},
  {"id": "checks", "kind": "healthchecks", "enabled": true, "healthchecks": {"url": "https://hc-ping.com/SECRETCHECK", "byKey": {"photos": "https://hc-ping.com/SECRETJOBCHECK"}}}
]}`

var secretWords = []string{"SECRETHOOK", "SECRETHEADER", "SECRETTOKEN", "SECRETPASSWORD", "SECRETKEY", "SECRETCHECK", "SECRETJOBCHECK"}

func storedChannels(t *testing.T, h *harness) string {
	t.Helper()
	return string(mustJSON(t, h.runner.Config().Notify.Channels))
}

// The Matrix token posts as the account, a mail password logs in, a header
// carries a key, and a webhook's, an Apprise server's and a check's address
// are their own keys, so none goes back to the screen, and the placeholder
// the screen sends back keeps them.
func TestTheNotificationSecretsStayOnTheServer(t *testing.T) {
	h := newHarness(t)
	resp, answer := putJSON(t, h.srv, "/api/settings", `{"notify":`+allSecrets+`}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save: %s %s", resp.Status, answer)
	}
	before := storedChannels(t, h)
	_, read := doJSON(t, h.srv, http.MethodGet, "/api/settings", "")
	for _, secret := range secretWords {
		if strings.Contains(answer, secret) || strings.Contains(read, secret) {
			t.Errorf("the settings carry %s", secret)
		}
	}
	// What is not secret comes back, or the page could not show it.
	for _, plain := range []string{"matrix.example.org", "mail.example.org", "arrowloop", "backups", `"photos"`, "Authorization"} {
		if !strings.Contains(read, plain) {
			t.Errorf("the settings lost %s: %s", plain, read)
		}
	}

	// The page saves back what it was given, placeholders and all.
	if resp, body := putJSON(t, h.srv, "/api/settings", read); resp.StatusCode != http.StatusOK {
		t.Fatalf("save the page's copy back: %s %s", resp.Status, body)
	}
	if after := storedChannels(t, h); after != before {
		t.Errorf("the placeholders replaced what was stored:\n%s\nwas\n%s", after, before)
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

// A file from before the channel list keeps its older keys beside the
// channels when the page saves, and they never reach the page.
func TestTheOlderKeysStayInTheFileAndOffThePage(t *testing.T) {
	h := engineFor(t, `{"notify":{"webhook":"https://hooks.example/OLDHOOK","webhookFormat":"slack","matrix":{"homeserver":"https://m.example","room":"!r:m.example","token":"syt_OLDTOKEN"}},`+
		`"jobs":[{"name":"photos","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/photos.db"}]}`)
	if got := len(h.runner.Config().Notify.Channels); got != 2 {
		t.Fatalf("the older file gave %d channels", got)
	}
	for _, path := range []string{"/api/settings", "/api/diagnostics"} {
		_, text := doJSON(t, h.srv, http.MethodGet, path, "")
		for _, secret := range []string{"OLDHOOK", "syt_OLDTOKEN"} {
			if strings.Contains(text, secret) {
				t.Errorf("%s carries %s", path, secret)
			}
		}
	}
	_, read := doJSON(t, h.srv, http.MethodGet, "/api/settings", "")
	if resp, body := putJSON(t, h.srv, "/api/settings", read); resp.StatusCode != http.StatusOK {
		t.Fatalf("save the page's copy back: %s %s", resp.Status, body)
	}
	raw, err := os.ReadFile(h.configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, kept := range []string{`"webhookFormat"`, "syt_OLDTOKEN", `"channels"`} {
		if !strings.Contains(string(raw), kept) {
			t.Errorf("the file lost %s:\n%s", kept, raw)
		}
	}
}

// A backup from before the channel list is restored with its channels.
func TestAnOlderBackupIsRestoredWithItsChannels(t *testing.T) {
	h := newHarness(t)
	old := fmt.Sprintf(`{"notify":{"onSuccess":true,"healthchecks":{"url":"https://hc-ping.com/all","jobs":{"photos":"https://hc-ping.com/photos"}}},`+
		`"jobs":[{"name":"photos","left":%q,"right":%q,"state":"photos.db"}]}`, filepath.ToSlash(h.left), filepath.ToSlash(h.right))
	if resp, body := putJSON(t, h.srv, "/api/config/raw", old); resp.StatusCode != http.StatusOK {
		t.Fatalf("restore: %s %s", resp.Status, body)
	}
	channels := h.runner.Config().Notify.Channels
	if len(channels) != 1 || channels[0].Healthchecks == nil || channels[0].Healthchecks.ByKey["photos"] != "https://hc-ping.com/photos" {
		t.Errorf("the restored backup has %+v", channels)
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
	putJSON(t, h.srv, "/api/settings", `{"notify":{"channels":[{"id":"s","kind":"slack","enabled":true,"slack":{"url":"`+hook.URL+`/SECRETPATH"}}]}}`)

	test := `{"channel":{"id":"s","kind":"slack","slack":{"url":"********"}}}`
	_, answer := doJSON(t, h.srv, http.MethodPost, "/api/notify/test", test)
	if !strings.Contains(answer, `"ok":true`) || len(got) != 1 || got[0] != "/SECRETPATH" {
		t.Fatalf("the test answered %s and reached %v", answer, got)
	}

	hook.Close()
	_, answer = doJSON(t, h.srv, http.MethodPost, "/api/notify/test", test)
	if !strings.Contains(answer, `"ok":false`) || !strings.Contains(answer, `"code":"refused"`) {
		t.Errorf("a failed test answered %s", answer)
	}
	if strings.Contains(answer, "SECRETPATH") {
		t.Errorf("the answer carries the address: %s", answer)
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
	before := storedChannels(t, h)

	_, answer := doJSON(t, h.srv, http.MethodPost, "/api/notify/test",
		`{"channel":{"id":"room","kind":"matrix","matrix":{"homeserver":"`+stranger.URL+`","room":"!a:example.org","token":"********"}}}`)
	if len(reached) != 0 {
		t.Errorf("the saved token went to another homeserver: %v", reached)
	}
	if !strings.Contains(answer, `"ok":false`) || !strings.Contains(answer, `"code":"moved"`) {
		t.Errorf("the test answered %s", answer)
	}

	moved := `{"notify":{"channels":[{"id":"room","kind":"matrix","enabled":true,"matrix":{"homeserver":"https://elsewhere.example","room":"!a:example.org","token":"********"}}]}}`
	if resp, body := putJSON(t, h.srv, "/api/settings", moved); resp.StatusCode != http.StatusBadRequest || !strings.Contains(body, "type it again") {
		t.Errorf("a changed homeserver with the placeholder answered %s %s", resp.Status, body)
	}
	if after := storedChannels(t, h); after != before {
		t.Errorf("a refused save changed the channels")
	}

	// A new server with the secret typed again is a plain change.
	typed := strings.Replace(moved, `"token":"********"`, `"token":"NEWTOKEN"`, 1)
	if resp, body := putJSON(t, h.srv, "/api/settings", typed); resp.StatusCode != http.StatusOK || h.runner.Config().Notify.Channels[0].Matrix.Token != "NEWTOKEN" {
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
	_, answer := doJSON(t, h.srv, http.MethodPost, "/api/notify/test", `{"channel":{"id":"s","kind":"slack","slack":{"url":"`+hook.URL+`/x"}}}`)
	if strings.Contains(answer, "INTERNAL ADMIN PAGE") {
		t.Errorf("the answer carries the server's page: %s", answer)
	}
	if !strings.Contains(answer, `"ok":false`) || !strings.Contains(answer, "403") {
		t.Errorf("the answer lost the status: %s", answer)
	}
}
