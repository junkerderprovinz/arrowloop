package history

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// skipped is a skip as a run writes it, with its reason's code and values
// beside the English sentence.
var skipped = Entry{
	Kind: "skip",
	Path: "app.log",
	Note: "was being written on the left side while it was copied, in 3 runs in a row, leaving it for the next run. While it was read its size changed from 4 to 9 bytes.",
	Code: "inFlux",
	Vars: map[string]string{"side": "left", "runs": "3", "details": "While it was read its size changed from 4 to 9 bytes.", "sizeFrom": "4", "sizeTo": "9"},
}

func TestAnEntryKeepsItsReasonCodeAndValues(t *testing.T) {
	db := openAt(t, filepath.Join(t.TempDir(), "runs.db"))
	defer db.Close()
	ctx := context.Background()
	now := time.Now()
	if err := db.Record(ctx, Run{Job: "logs", Started: now, Finished: now}, []Entry{skipped, {Kind: "copy", Side: "right", Path: "a.txt"}}); err != nil {
		t.Fatal(err)
	}
	runs, err := db.Recent(ctx, "logs", ShowAll, 1)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %d runs", err, len(runs))
	}
	entries, err := db.Entries(ctx, runs[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(entries[0], skipped) {
		t.Errorf("the skip came back as %+v, want %+v", entries[0], skipped)
	}
	if entries[1].Code != "" || entries[1].Vars != nil {
		t.Errorf("a copy came back with a reason: %+v", entries[1])
	}
	touches, err := db.Log(ctx, Filter{Job: runs[0].Key(), Kinds: []string{"skip"}})
	if err != nil || len(touches) != 1 {
		t.Fatalf("log: %v, %d lines", err, len(touches))
	}
	if !reflect.DeepEqual(touches[0].Entry, skipped) {
		t.Errorf("the file log reads %+v, want %+v", touches[0].Entry, skipped)
	}
	said, err := json.Marshal(entries[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(said), `"Code":"inFlux"`) || !strings.Contains(string(said), `"sizeTo":"9"`) {
		t.Errorf("the interface is sent %s, without the code and its values", said)
	}
}

func TestAnEntryOfARunCutOffKeepsItsReasonCodeAndValues(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "runs.db")
	first := openAt(t, path)
	start := time.Now().Add(-10 * time.Minute)
	first.Begin(Run{Job: "logs", Started: start}).Add(skipped)
	if err := first.checkpoint(ctx, start.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	kill(first)

	again := openAt(t, path)
	defer again.Close()
	runs, err := again.Recent(ctx, "logs", ShowAll, 1)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %d runs", err, len(runs))
	}
	entries, err := again.Entries(ctx, runs[0].ID)
	if err != nil || len(entries) != 1 {
		t.Fatalf("entries: %v, %d lines", err, len(entries))
	}
	if !reflect.DeepEqual(entries[0], skipped) {
		t.Errorf("the skip came back as %+v, want %+v", entries[0], skipped)
	}
}

func TestAnEntryFromBeforeReasonCodesKeepsItsNote(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "runs.db")
	oldLayout(t, path, time.Now().Add(-time.Hour))
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE TABLE entries (run INTEGER NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, side TEXT NOT NULL,
			path TEXT NOT NULL, note TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (run, seq))`,
		`INSERT INTO entries (run, seq, kind, side, path, note) VALUES (1, 0, 'skip', '', 'big.iso', 'copy failed, leaving it for the next run: permission denied')`,
	} {
		if _, err := raw.ExecContext(ctx, q); err != nil {
			raw.Close()
			t.Fatalf("%s: %v", q, err)
		}
	}
	raw.Close()

	db := openAt(t, path)
	defer db.Close()
	entries, err := db.Entries(ctx, 1)
	if err != nil || len(entries) != 1 {
		t.Fatalf("entries: %v, %d lines", err, len(entries))
	}
	want := Entry{Kind: "skip", Path: "big.iso", Note: "copy failed, leaving it for the next run: permission denied"}
	if !reflect.DeepEqual(entries[0], want) {
		t.Errorf("the older entry came back as %+v, want %+v", entries[0], want)
	}
	said, _ := json.Marshal(entries[0])
	if strings.Contains(string(said), "Code") || strings.Contains(string(said), "Vars") {
		t.Errorf("the interface is sent %s, with an empty code it would have to tell from none", said)
	}
}
