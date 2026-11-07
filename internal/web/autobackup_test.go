package web_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/autobackup"
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
)

func put(t *testing.T, h *harness, path, body string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPut, h.srv.URL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestTheSettingsListTheAutomaticBackups(t *testing.T) {
	h := newHarness(t)
	if err := h.runner.BackUp(time.Now()); err != nil {
		t.Fatal(err)
	}

	var got daemon.Backups
	h.get(t, "/api/config/backups", &got)
	if !got.On || got.Folder != filepath.Join(h.dir, "backups") {
		t.Errorf("the state reads on %v in %s", got.On, got.Folder)
	}
	if len(got.Files) != 1 || got.Last == nil || got.Last.File != got.Files[0].Name {
		t.Fatalf("the state lists %+v, last %+v", got.Files, got.Last)
	}

	resp, err := h.srv.Client().Get(h.srv.URL + "/api/config/backups/" + got.Files[0].Name)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	want, _ := os.ReadFile(h.configPath)
	if resp.StatusCode != http.StatusOK || !bytes.Equal(body, want) {
		t.Errorf("the backup answered %s with %s", resp.Status, body)
	}
}

func TestOnlyABackupCanBeFetched(t *testing.T) {
	h := newHarness(t)
	for _, name := range []string{"arrowloop.json", "history.db", "..%2farrowloop.json", "arrowloop-auto-20261107-120000.json"} {
		resp, err := h.srv.Client().Get(h.srv.URL + "/api/config/backups/" + name)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s answered %s", name, resp.Status)
		}
	}
}

// An import replaces everything, so what it replaces is kept first, and the
// backup goes back through the same import.
func TestAnImportKeepsTheSetupItReplaces(t *testing.T) {
	h := newHarness(t)
	before, _ := os.ReadFile(h.configPath)

	if resp := put(t, h, "/api/config/raw", `{"jobs":[]}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("the import answered %s", resp.Status)
	}
	files, err := autobackup.List(filepath.Join(h.dir, "backups"))
	if err != nil || len(files) != 1 {
		t.Fatalf("%d backups after the import: %v", len(files), err)
	}
	kept, _ := autobackup.Read(filepath.Join(h.dir, "backups"), files[0].Name)
	if !bytes.Equal(kept, before) {
		t.Fatalf("the backup holds %s, not the setup before the import", kept)
	}

	if resp := put(t, h, "/api/config/raw", string(kept)); resp.StatusCode != http.StatusOK {
		t.Fatalf("restoring the backup answered %s", resp.Status)
	}
	if _, ok := h.runner.Config().Find("photos"); !ok {
		t.Error("restoring the backup did not bring the job back")
	}
}

func TestABackupFolderThatCannotBeWrittenIsRefused(t *testing.T) {
	h := newHarness(t)
	blocker := filepath.Join(h.dir, "a-file")
	os.WriteFile(blocker, []byte("x"), 0o600)
	body, _ := json.Marshal(map[string]any{"autoBackup": map[string]any{"folder": filepath.Join(blocker, "backups")}})

	resp := put(t, h, "/api/settings", string(body))
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("an unwritable folder answered %s", resp.Status)
	}
	if h.runner.Config().AutoBackup.Folder != "" {
		t.Error("the refused folder was saved")
	}

	ok, _ := json.Marshal(map[string]any{"autoBackup": map[string]any{"folder": "saved", "keep": 3}})
	if resp := put(t, h, "/api/settings", string(ok)); resp.StatusCode != http.StatusOK {
		t.Errorf("a folder beside the configuration answered %s", resp.Status)
	}
}
