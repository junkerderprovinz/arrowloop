package web_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"

	_ "github.com/rclone/rclone/backend/alias"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

type browseAnswer struct {
	Path    string `json:"path"`
	Parent  string `json:"parent"`
	Shown   string `json:"shown"`
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

// listedNames asks the picker for the folders in at and returns their names.
func listedNames(t *testing.T, h *harness, at, query string) []string {
	t.Helper()
	var got browseAnswer
	h.get(t, "/api/browse?path="+url.QueryEscape(at)+query, &got)
	names := []string{}
	for _, e := range got.Entries {
		names = append(names, e.Name)
	}
	return names
}

func TestHiddenFoldersAreListedOnlyWhenAskedFor(t *testing.T) {
	h := newHarness(t)
	dir := t.TempDir()
	for _, name := range []string{"Music", ".backup", ".arrowloop"} {
		if err := os.Mkdir(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	if got := listedNames(t, h, dir, ""); !slices.Equal(got, []string{"Music"}) {
		t.Errorf("the folder lists %q", got)
	}
	// ArrowLoop's own folder is never a side, shown or not.
	if got := listedNames(t, h, dir, "&hidden=1"); !slices.Equal(got, []string{".backup", "Music"}) {
		t.Errorf("with hidden folders shown, the folder lists %q", got)
	}
}

func TestHiddenFoldersOnADriveAreListedWithoutItsMarker(t *testing.T) {
	h := newHarness(t)
	mount, at := markedDrive(t)
	if err := os.Mkdir(filepath.Join(mount, ".backup"), 0o755); err != nil {
		t.Fatal(err)
	}

	if got := listedNames(t, h, at+"/", ""); len(got) != 0 {
		t.Errorf("the top of the drive lists %q", got)
	}
	if got := listedNames(t, h, at+"/", "&hidden=1"); !slices.Equal(got, []string{".backup"}) {
		t.Errorf("with hidden folders shown, the top of the drive lists %q", got)
	}
}

// markedDrive marks a folder as a drive called Backup and returns its mount
// and the path a job stores for it.
func markedDrive(t *testing.T) (mount, at string) {
	t.Helper()
	mount = t.TempDir()
	previous := volume.Candidates
	volume.Candidates = func() []string { return []string{mount} }
	t.Cleanup(func() { volume.Candidates = previous })
	m, err := volume.Mark(mount, "Backup")
	if err != nil {
		t.Fatalf("mark the drive: %v", err)
	}
	return mount, volume.Prefix + m.ID
}

func TestThePickerWalksADriveByItsIdentity(t *testing.T) {
	h := newHarness(t)
	mount, at := markedDrive(t)
	if err := os.MkdirAll(filepath.Join(mount, "Music", "Live"), 0o755); err != nil {
		t.Fatal(err)
	}

	var top browseAnswer
	h.get(t, "/api/browse?path="+url.QueryEscape(at+"/"), &top)
	if top.Shown != "Backup" || top.Parent != "" {
		t.Errorf("the top of the drive reads %q with parent %q", top.Shown, top.Parent)
	}
	// The marker folder stays out of the list.
	if len(top.Entries) != 1 || top.Entries[0].Path != at+"/Music" {
		t.Fatalf("the top of the drive lists %+v", top.Entries)
	}

	var inner browseAnswer
	h.get(t, "/api/browse?path="+url.QueryEscape(top.Entries[0].Path), &inner)
	if inner.Parent != at+"/" {
		t.Errorf("one level down, up leads to %q", inner.Parent)
	}
	if len(inner.Entries) != 1 || inner.Entries[0].Path != at+"/Music/Live" {
		t.Errorf("Music lists %+v", inner.Entries)
	}

	var climbed browseAnswer
	h.get(t, "/api/browse?path="+url.QueryEscape(at+"/../.."), &climbed)
	if climbed.Path != at+"/" {
		t.Errorf("a path climbing off the drive answered %q", climbed.Path)
	}
}

func TestANewFolderLandsOnTheDrive(t *testing.T) {
	h := newHarness(t)
	mount, at := markedDrive(t)

	body, _ := json.Marshal(map[string]string{"parent": at + "/", "name": "Music"})
	resp := h.post(t, "/api/browse/mkdir", string(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("making a folder on a drive answered %s", resp.Status)
	}
	var made struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&made); err != nil {
		t.Fatal(err)
	}
	if made.Path != at+"/Music" {
		t.Errorf("the new folder is reported as %q", made.Path)
	}
	if info, err := os.Stat(filepath.Join(mount, "Music")); err != nil || !info.IsDir() {
		t.Errorf("no folder arrived on the drive: %v", err)
	}
}

func TestAnUnreadableFolderIsExplained(t *testing.T) {
	h := newHarness(t)
	missing := filepath.Join(t.TempDir(), "gone")

	resp, err := h.srv.Client().Get(h.srv.URL + "/api/browse?path=" + url.QueryEscape(missing))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var got struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("the refusal was not JSON, so the app can only show its status: %v", err)
	}
	if resp.StatusCode != http.StatusBadRequest || got.Error == "" {
		t.Errorf("got %d %q, want 400 with the reason", resp.StatusCode, got.Error)
	}
}

// phoneVolumes writes the list of removable storage the app passes on and
// points the engine at it.
func phoneVolumes(t *testing.T, lines string) {
	t.Helper()
	file := filepath.Join(t.TempDir(), "volumes")
	if err := os.WriteFile(file, []byte(lines), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ARROWLOOP_VOLUMES_FILE", file)
}

func TestTheTopOffersTheCardsThePhoneReports(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the top of a Windows tree lists drive letters")
	}
	h := newHarness(t)
	card := t.TempDir()
	phoneVolumes(t, card+"\tSanDisk SD card\n"+filepath.Join(card, "ejected")+"\tUSB drive\n")

	var top browseAnswer
	h.get(t, "/api/browse", &top)
	var cards, roots int
	for _, e := range top.Entries {
		switch {
		case e.Name == "SanDisk SD card" && e.Path == card:
			cards++
		case e.Name == "USB drive":
			t.Error("a volume that is not mounted was offered")
		case e.Path == "/":
			roots++
		}
	}
	if cards != 1 {
		t.Errorf("the card is missing from the top: %+v", top.Entries)
	}
	if roots != 0 {
		t.Error(`"/" was offered on a phone, where Android refuses to list it`)
	}
}
