package web_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// TestABackupComesBackByteForByte.
//
// The whole value of a backup. Re-serialising through a struct would drop every
// key this build has never heard of and rewrite the relative paths somebody
// chose on purpose, and the loss would only show up on the day the backup was
// needed.
func TestABackupComesBackByteForByte(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})

	resp, err := srv.Client().Get(srv.URL + "/api/config/raw")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	got, _ := io.ReadAll(resp.Body)

	want, err := os.ReadFile(h.configPath)
	if err != nil {
		t.Fatalf("read the file: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("the backup is not the file:\n file %s\n got  %s", want, got)
	}
}

// TestARestoreIsCheckedBeforeItLands.
//
// Restoring is the one action here that replaces everything, so a bad file must
// fail at the door. It goes through the same validator a hand-written file does
// and the old configuration stays exactly where it was.
func TestARestoreIsCheckedBeforeItLands(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})

	before, _ := os.ReadFile(h.configPath)

	for _, bad := range []string{
		`this is not json at all`,
		`{"jobs":[{"left":"/a","right":"/b"}]}`, // no name
		`{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","schedule":"every tuesday-ish"}]}`,
	} {
		req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/config/raw", bytes.NewReader([]byte(bad)))
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("restoring %q answered %s rather than refusing it", bad, resp.Status)
		}
	}

	after, _ := os.ReadFile(h.configPath)
	if !bytes.Equal(before, after) {
		t.Error("a refused restore changed the file anyway")
	}
}

// TestAGoodRestoreReplacesEverything.
//
// Replaces, not merges. A restore that kept a job the backup did not have would
// be a restore that does not restore, and the job it kept would be the one
// somebody deleted on purpose before making the copy.
func TestAGoodRestoreReplacesEverything(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})

	// A key the machine has and the backup does not. This is the case a merge
	// gets wrong and a replace gets right, and it is the only case that can tell
	// them apart: a key the backup DOES mention is overwritten either way.
	//
	// It matters because the setting somebody removed on purpose before making
	// the copy is exactly the one a merge would put back.
	set, _ := json.Marshal(map[string]any{"parallelJobs": 7})
	setReq, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/settings", bytes.NewReader(set))
	setResp, err := srv.Client().Do(setReq)
	if err != nil {
		t.Fatal(err)
	}
	setResp.Body.Close()

	doc := `{"bwlimit":"3M","jobs":[]}`
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/config/raw", bytes.NewReader([]byte(doc)))
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("restoring answered %s: %s", resp.Status, body)
	}

	raw, _ := os.ReadFile(h.configPath)
	var now map[string]any
	if err := json.Unmarshal(raw, &now); err != nil {
		t.Fatalf("invalid JSON after restore: %v", err)
	}
	if now["bwlimit"] != "3M" {
		t.Errorf("the restored bwlimit is %v", now["bwlimit"])
	}
	jobs, _ := now["jobs"].([]any)
	if len(jobs) != 0 {
		t.Errorf("the machine's old job survived a restore that had none: %v", now["jobs"])
	}
	if _, still := now["parallelJobs"]; still {
		t.Errorf("a setting the backup never mentioned survived the restore: %v", now["parallelJobs"])
	}
}
