package web_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	_ "github.com/rclone/rclone/backend/alias"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

type browseAnswer struct {
	Path    string `json:"path"`
	Parent  string `json:"parent"`
	Entries []struct {
		Name string `json:"name"`
		Path string `json:"path"`
	} `json:"entries"`
}

// aliasTarget saves a target called box that is a folder on this machine, so
// the picker can walk a target without a network.
func aliasTarget(t *testing.T) string {
	t.Helper()
	withRcloneConfig(t)
	root := t.TempDir()
	if err := remotes.Save("box", "alias", map[string]string{"remote": root}); err != nil {
		t.Fatalf("save the target: %v", err)
	}
	return root
}

func TestThePickerWalksATarget(t *testing.T) {
	h := newHarness(t)
	root := aliasTarget(t)
	if err := os.MkdirAll(filepath.Join(root, "Photos", "2024"), 0o755); err != nil {
		t.Fatal(err)
	}

	var top browseAnswer
	h.get(t, "/api/browse?path="+url.QueryEscape("box:"), &top)
	if top.Path != "box:" || top.Parent != "" {
		t.Errorf("the top of the target answers path %q, parent %q", top.Path, top.Parent)
	}
	if len(top.Entries) != 1 || top.Entries[0].Name != "Photos" || top.Entries[0].Path != "box:Photos" {
		t.Fatalf("the top of the target lists %+v", top.Entries)
	}

	var inner browseAnswer
	h.get(t, "/api/browse?path="+url.QueryEscape(top.Entries[0].Path), &inner)
	if inner.Parent != "box:" {
		t.Errorf("one level down, up leads to %q", inner.Parent)
	}
	if len(inner.Entries) != 1 || inner.Entries[0].Path != "box:Photos/2024" {
		t.Errorf("Photos lists %+v", inner.Entries)
	}
}

func TestANewFolderLandsOnTheTarget(t *testing.T) {
	h := newHarness(t)
	root := aliasTarget(t)

	resp := h.post(t, "/api/browse/mkdir", `{"parent":"box:","name":"Holiday"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("making a folder on a target answered %s", resp.Status)
	}
	var made struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&made); err != nil {
		t.Fatal(err)
	}
	if made.Path != "box:Holiday" {
		t.Errorf("the new folder is reported as %q", made.Path)
	}
	if info, err := os.Stat(filepath.Join(root, "Holiday")); err != nil || !info.IsDir() {
		t.Errorf("no folder arrived on the target: %v", err)
	}
}

func TestAFolderNameOnATargetCannotClimbOut(t *testing.T) {
	h := newHarness(t)
	aliasTarget(t)

	for _, name := range []string{"..", "a/b", `a\b`} {
		body, _ := json.Marshal(map[string]string{"parent": "box:", "name": name})
		resp := h.post(t, "/api/browse/mkdir", string(body))
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("the name %q was accepted on a target: %s", name, resp.Status)
		}
	}
}

func TestAnUnknownTargetIsNotListed(t *testing.T) {
	h := newHarness(t)
	withRcloneConfig(t)

	resp, err := h.srv.Client().Get(h.srv.URL + "/api/browse?path=" + url.QueryEscape("nowhere:Photos"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Error("a path naming no configured target was answered as if it were one")
	}
}

func TestTheSharesListIsAListEvenWhenEmpty(t *testing.T) {
	h := newHarness(t)
	var got struct {
		Shares []json.RawMessage `json:"shares"`
	}
	h.get(t, "/api/shares", &got)
	if got.Shares == nil {
		t.Error("the shares arrived as null, which the page would have to guard against")
	}
}
