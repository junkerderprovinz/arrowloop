package apply

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// A run that counts a file as left for later also says which file it was.
func TestASkipFoundWhilePlanningIsInTheRunsLog(t *testing.T) {
	ctx := context.Background()
	db, err := state.Open(ctx, filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	defer db.Close()

	p := &plan.Plan{Skipped: []plan.Skip{{Path: "a/b.txt", Reason: plan.Because("unsupported", "kind", "a socket", "side", "left")}}}
	res, err := Run(ctx, Ends{}, db, p, plan.Options{})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(res.Skipped) != 1 {
		t.Fatalf("counted %d skips, want 1", len(res.Skipped))
	}
	if len(res.Entries) != 1 || res.Entries[0].Kind != "skip" || res.Entries[0].Path != "a/b.txt" {
		t.Fatalf("log holds %+v, want the skip for a/b.txt", res.Entries)
	}
}
