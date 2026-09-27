package web_test

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type conflictList struct {
	Conflicts []struct {
		Job, Copy, Plain, Side, At string
		Left, Right                struct {
			Path string
			Size int64
			Mod  string
		}
	}
	Unread []struct{ Job, Error string }
}

// keepBoth leaves notes.txt as a conflict a run kept both versions of, with
// the left edit the older one.
func keepBoth(t *testing.T, h *harness) {
	t.Helper()
	ctx := context.Background()
	stamp := func(dir string, when time.Time) {
		if err := os.Chtimes(filepath.Join(dir, "notes.txt"), when, when); err != nil {
			t.Fatalf("stamp: %v", err)
		}
	}
	write(t, h.left, "notes.txt", "first")
	stamp(h.left, time.Now().Add(-2*time.Hour))
	if _, err := h.runner.Run(ctx, "photos"); err != nil {
		t.Fatalf("first run: %v", err)
	}
	write(t, h.left, "notes.txt", "left edit")
	stamp(h.left, time.Now().Add(-time.Hour))
	write(t, h.right, "notes.txt", "right edit, and longer")
	if _, err := h.runner.Run(ctx, "photos"); err != nil {
		t.Fatalf("second run: %v", err)
	}
}

func TestTheConflictListShowsBothVersions(t *testing.T) {
	h := newHarness(t)
	keepBoth(t, h)

	var list conflictList
	h.get(t, "/api/conflicts", &list)
	if len(list.Conflicts) != 1 {
		t.Fatalf("expected one conflict, got %+v", list)
	}
	c := list.Conflicts[0]
	if c.Job != "photos" || c.Plain != "notes.txt" || c.Side != "left" || !strings.Contains(c.Copy, ".conflict-left-") {
		t.Fatalf("the conflict reads wrong: %+v", c)
	}
	if c.Left.Size != int64(len("left edit")) || c.Right.Size != int64(len("right edit, and longer")) {
		t.Errorf("the sizes are %d and %d", c.Left.Size, c.Right.Size)
	}
	if c.Left.Mod >= c.Right.Mod {
		t.Errorf("the right version is the newer, got %s and %s", c.Left.Mod, c.Right.Mod)
	}
}

func TestDecidingOverTheAPIChangesTheFilesOnDisk(t *testing.T) {
	h := newHarness(t)
	keepBoth(t, h)
	var list conflictList
	h.get(t, "/api/conflicts", &list)

	resp := h.post(t, "/api/jobs/photos/conflicts", `{"decisions":[{"copy":"`+list.Conflicts[0].Copy+`","keep":"left"}]}`)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("decide: %s %s", resp.Status, body)
	}
	for _, dir := range []string{h.left, h.right} {
		got, err := os.ReadFile(filepath.Join(dir, "notes.txt"))
		if err != nil || string(got) != "left edit" {
			t.Errorf("%s holds %q (%v), not the chosen version", dir, got, err)
		}
	}

	h.get(t, "/api/conflicts", &list)
	if len(list.Conflicts) != 0 {
		t.Errorf("the decided conflict is still listed: %+v", list.Conflicts)
	}
}

func TestDecidingNothingIsRefused(t *testing.T) {
	h := newHarness(t)
	for path, want := range map[string]int{
		"/api/jobs/photos/conflicts": http.StatusBadRequest,
		"/api/jobs/nobody/conflicts": http.StatusNotFound,
	} {
		resp := h.post(t, path, `{"decisions":[]}`)
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("%s answered %s, want %d", path, resp.Status, want)
		}
	}
}
