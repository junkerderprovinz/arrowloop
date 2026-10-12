package web_test

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

type trashList struct {
	Sides []struct {
		Job, Side, Error string
		Total            int
		Bytes            int64
		Entries          []struct{ Path, RunID string }
		Mark             string
	}
}

// markOfSide reads the mark the listing gives one side.
func markOfSide(t *testing.T, h *harness, side string) string {
	t.Helper()
	var list trashList
	h.get(t, "/api/trash", &list)
	for _, s := range list.Sides {
		if s.Side == side {
			return s.Mark
		}
	}
	t.Fatalf("no %s side in the listing", side)
	return ""
}

func binned(t *testing.T, root, run, rel, body string) {
	t.Helper()
	write(t, root, ".arrowloop/trash/"+run+"/"+rel, body)
}

func TestTheTrashIsListedForEverySide(t *testing.T) {
	h := newHarness(t)
	binned(t, h.left, "20260901-080000", "a.txt", "aaaa")
	binned(t, h.right, "20260902-080000", "docs/b.txt", "bb")
	binned(t, h.right, "20260903-080000", "c.txt", "c")

	var list trashList
	h.get(t, "/api/trash", &list)
	if len(list.Sides) != 2 {
		t.Fatalf("expected both sides of the one job, got %+v", list)
	}
	for _, s := range list.Sides {
		if s.Error != "" {
			t.Errorf("the %s side failed: %s", s.Side, s.Error)
		}
		switch s.Side {
		case "left":
			if s.Total != 1 || s.Bytes != 4 {
				t.Errorf("the left side reads %d entries, %d bytes", s.Total, s.Bytes)
			}
		case "right":
			if s.Total != 2 || s.Bytes != 3 || s.Entries[0].Path != "c.txt" {
				t.Errorf("the right side reads %+v", s)
			}
		}
	}

	h.get(t, "/api/trash?job=nobody", &list)
	if len(list.Sides) != 0 {
		t.Errorf("an unknown job listed sides: %+v", list.Sides)
	}
}

func TestASideThatCannotBeOpenedStillListsNoEntries(t *testing.T) {
	h := engineFor(t, `{"jobs":[{"name":"share","left":"%[1]s/left",`+
		`"right":":sftp,host=127.0.0.1,port=1,user=demo:/x","state":"%[1]s/share.db"}]}`)

	var list struct {
		Sides []map[string]any
	}
	h.get(t, "/api/trash", &list)
	for _, s := range list.Sides {
		if _, ok := s["entries"].([]any); !ok {
			t.Errorf("the %v side sent entries %v instead of a list", s["side"], s["entries"])
		}
		if s["side"] == "right" && s["error"] == nil {
			t.Errorf("the unreachable side answered without an error: %v", s)
		}
	}
}

func TestOneTrashedFileCanBeRestoredOrDeleted(t *testing.T) {
	h := newHarness(t)
	binned(t, h.left, "20260901-080000", "keep.txt", "wanted")
	binned(t, h.left, "20260901-080000", "drop.txt", "unwanted")

	resp := h.post(t, "/api/jobs/photos/trash/left/restore", `{"path":"keep.txt","runId":"20260901-080000"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("restore: %s", resp.Status)
	}
	if got, err := os.ReadFile(filepath.Join(h.left, "keep.txt")); err != nil || string(got) != "wanted" {
		t.Errorf("the restored file reads %q (%v)", got, err)
	}

	resp = h.post(t, "/api/jobs/photos/trash/left/delete", `{"path":"drop.txt","runId":"20260901-080000"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete: %s", resp.Status)
	}
	if _, err := os.Stat(filepath.Join(h.left, ".arrowloop", "trash", "20260901-080000", "drop.txt")); !os.IsNotExist(err) {
		t.Errorf("the deleted entry is still there: %v", err)
	}
	if _, err := os.Stat(filepath.Join(h.left, "drop.txt")); !os.IsNotExist(err) {
		t.Errorf("deleting the entry put it back: %v", err)
	}

	resp = h.post(t, "/api/jobs/photos/trash/left/delete", `{"path":"../../drop.txt","runId":"20260901-080000"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a path out of the trash answered %s", resp.Status)
	}
}

func TestEmptyingOneSideLeavesTheOther(t *testing.T) {
	h := newHarness(t)
	binned(t, h.left, "20260901-080000", "a.txt", "aaaa")
	binned(t, h.left, "20260902-080000", "b.txt", "bb")
	binned(t, h.right, "20260901-080000", "a.txt", "aaaa")

	resp := h.post(t, "/api/jobs/photos/trash/left/empty", `{"mark":"`+markOfSide(t, h, "left")+`"}`)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("empty: %s %s", resp.Status, body)
	}

	var list trashList
	h.get(t, "/api/trash", &list)
	for _, s := range list.Sides {
		want := map[string]int{"left": 0, "right": 1}[s.Side]
		if s.Total != want {
			t.Errorf("the %s side holds %d entries, want %d", s.Side, s.Total, want)
		}
	}
}

// A file binned after the confirmation was drawn is not what somebody agreed
// to delete, so the whole emptying is refused.
func TestATrashThatChangedSinceItWasShownIsNotEmptied(t *testing.T) {
	h := newHarness(t)
	binned(t, h.left, "20260901-080000", "a.txt", "aaaa")
	shown := markOfSide(t, h, "left")
	binned(t, h.left, "20260902-080000", "late.txt", "new")

	for _, route := range []struct{ path, body string }{
		{"/api/jobs/photos/trash/left/empty", `{"mark":"` + shown + `"}`},
		{"/api/jobs/photos/trash/left/prune", `{"olderThanDays":1,"mark":"` + shown + `"}`},
	} {
		resp := h.post(t, route.path, route.body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusConflict {
			t.Errorf("%s with the old mark answered %s", route.path, resp.Status)
		}
	}
	var list trashList
	h.get(t, "/api/trash", &list)
	for _, side := range list.Sides {
		if side.Side == "left" && side.Total != 2 {
			t.Errorf("the left trash holds %d entries after a refused emptying, want 2", side.Total)
		}
	}

	resp := h.post(t, "/api/jobs/photos/trash/left/empty", `{"mark":"`+markOfSide(t, h, "left")+`"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("emptying with the current mark answered %s", resp.Status)
	}
}
