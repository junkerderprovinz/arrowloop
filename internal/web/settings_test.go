package web_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
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
