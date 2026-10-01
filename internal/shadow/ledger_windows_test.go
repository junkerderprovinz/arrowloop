package shadow

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// fakeWMI stands in for taking and removing copies, and records what was
// removed.
func fakeWMI(t *testing.T) *[]string {
	t.Helper()
	var removed []string
	takeWas, dropWas := create, remove
	t.Cleanup(func() { create, remove = takeWas, dropWas })
	create = func(_ context.Context, volume string) (string, string, error) {
		return "{copy of " + volume + "}", `\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy1`, nil
	}
	remove = func(_ context.Context, id string) error {
		removed = append(removed, id)
		return nil
	}
	return &removed
}

func TestACopyAKilledRunLeftBehindIsRemovedAtTheNextStart(t *testing.T) {
	removed := fakeWMI(t)
	ledger := filepath.Join(t.TempDir(), "shadow-copies.json")

	s := New(ledger)
	if _, err := s.Root(context.Background(), `C:\Users\me`); err != nil {
		t.Fatal(err)
	}
	// The process is killed here, so Close never runs.

	if err := Sweep(context.Background(), ledger); err != nil {
		t.Fatal(err)
	}
	if len(*removed) != 1 || (*removed)[0] != "{copy of C:}" {
		t.Errorf("the next start removed %v, want the copy the killed run took", *removed)
	}
	if _, err := os.Stat(ledger); !os.IsNotExist(err) {
		t.Errorf("the ledger still lists copies after they were removed: %v", err)
	}
}

func TestACopyRemovedByTheRunIsNotRemovedAgain(t *testing.T) {
	removed := fakeWMI(t)
	ledger := filepath.Join(t.TempDir(), "shadow-copies.json")

	s := New(ledger)
	if _, err := s.Root(context.Background(), `C:\Users\me`); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	*removed = nil
	if err := Sweep(context.Background(), ledger); err != nil {
		t.Fatal(err)
	}
	if len(*removed) != 0 {
		t.Errorf("the next start removed %v again", *removed)
	}
}

// A run in another process that is still going needs its copy.
func TestACopyOfAProcessStillRunningIsLeftAlone(t *testing.T) {
	removed := fakeWMI(t)
	ledger := filepath.Join(t.TempDir(), "shadow-copies.json")
	b, err := json.Marshal([]entry{{ID: "{still in use}", PID: os.Getppid()}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ledger, b, 0o644); err != nil {
		t.Fatal(err)
	}

	if err := Sweep(context.Background(), ledger); err != nil {
		t.Fatal(err)
	}
	if len(*removed) != 0 {
		t.Errorf("removed %v, which a running process still uses", *removed)
	}
	left, err := readLedger(ledger)
	if err != nil || len(left) != 1 {
		t.Errorf("the ledger lost the running process's copy: %v %v", left, err)
	}
}

func TestWithoutALedgerNothingIsRemoved(t *testing.T) {
	removed := fakeWMI(t)
	if err := Sweep(context.Background(), filepath.Join(t.TempDir(), "shadow-copies.json")); err != nil {
		t.Fatal(err)
	}
	if len(*removed) != 0 {
		t.Errorf("removed %v without a ledger listing anything", *removed)
	}
}
