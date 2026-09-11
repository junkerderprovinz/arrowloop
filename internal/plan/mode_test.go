package plan

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// The two modes a one-way job can be run in beyond plain copying, and both of
// them DELETE. That is why these cases are written against the same situation
// three times rather than once per mode: what separates them is not what each
// one does, it is what the other two do NOT do to the same file, and a test per
// mode in isolation cannot say that.

// The situation every case below shares: each side holds one file the other
// has never had, and nothing was ever recorded. One situation, three modes, so
// what separates them is visible as a difference rather than asserted three
// times over.
func bothWays(t *testing.T, dir Direction, mode Mode) *Plan {
	t.Helper()
	p, err := Build(
		context.Background(),
		listing(scan.Side{"mine.txt": live("mine.txt", 10, 0)}),
		listing(scan.Side{"theirs.txt": live("theirs.txt", 20, 0)}),
		map[string]state.Entry{},
		Options{ModWindow: 2 * time.Second},
	)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	Enforce(p, dir, mode)
	return p
}

func find(p *Plan, path string) (Action, bool) {
	for _, a := range p.Actions {
		if a.Path == path {
			return a, true
		}
	}
	return Action{}, false
}

func TestSyncLeavesTheFileTheSourceNeverHad(t *testing.T) {
	p := bothWays(t, LeftToRight, ModeSync)

	if a, ok := find(p, "mine.txt"); !ok || a.Kind != Copy {
		t.Fatalf("the source's own file was not sent: %+v", p.Actions)
	}
	// The whole difference between copying and mirroring, asserted as an
	// ABSENCE: a file the source has never had is not the destination's
	// mistake, and removing it would be making a decision rather than passing
	// one on.
	if a, ok := find(p, "theirs.txt"); ok {
		t.Fatalf("plain copying touched a file the source never had: %v on %v", a.Kind, a.Dst)
	}
}

func TestMirrorRemovesTheFileTheSourceNeverHad(t *testing.T) {
	p := bothWays(t, LeftToRight, ModeMirror)

	if a, ok := find(p, "mine.txt"); !ok || a.Kind != Copy {
		t.Fatalf("the source's own file was not sent: %+v", p.Actions)
	}
	a, ok := find(p, "theirs.txt")
	if !ok {
		t.Fatal("mirroring left a file the source does not have")
	}
	if a.Kind != Delete {
		t.Fatalf("mirroring proposed %v for a file only the destination has, want a deletion", a.Kind)
	}
	// On the DESTINATION. A mirror that removed it on the source would be
	// deleting the thing it is supposed to be copying from.
	if a.Dst != Right {
		t.Fatalf("mirroring deleted on %v, want the destination side", a.Dst)
	}
}

func TestMirrorNeverDeletesOnTheSource(t *testing.T) {
	for _, dir := range []Direction{LeftToRight, RightToLeft} {
		p := bothWays(t, dir, ModeMirror)
		src := dir.source()
		for _, a := range p.Actions {
			if a.Kind == Delete && a.Dst == src {
				t.Fatalf("%v mirror proposed a deletion on the source side: %+v", dir, a)
			}
		}
	}
}

func TestMoveTakesTheFileOffTheSource(t *testing.T) {
	p := bothWays(t, LeftToRight, ModeMove)

	a, ok := find(p, "mine.txt")
	if !ok {
		t.Fatal("the source's own file was not sent at all")
	}
	if a.Kind != Relocate {
		t.Fatalf("move mode proposed %v, want a relocate", a.Kind)
	}
	// ONE action. As a copy plus a separate deletion, a copy that failed would
	// leave the deletion behind it in the queue - which is the difference
	// between "the upload did not work" and "the original is gone".
	if n := len(p.Actions); n != 1 {
		t.Fatalf("move mode produced %d actions for one file: %+v", n, p.Actions)
	}
}

func TestMoveLeavesTheFileTheSourceNeverHad(t *testing.T) {
	p := bothWays(t, LeftToRight, ModeMove)

	// Moving is not mirroring. It empties the source of what it sends and says
	// nothing about what it never had.
	if a, ok := find(p, "theirs.txt"); ok {
		t.Fatalf("move mode touched a file the source never had: %v on %v", a.Kind, a.Dst)
	}
}

func TestBothWaysIgnoresTheMode(t *testing.T) {
	// Enforce returns immediately for a two-way job, so neither mode may leak
	// into one. Mirroring both ways is a contradiction and moving both ways
	// empties each side into the other.
	for _, mode := range []Mode{ModeMirror, ModeMove} {
		p := bothWays(t, Both, mode)
		for _, a := range p.Actions {
			if a.Kind == Relocate || a.Kind == Delete {
				t.Fatalf("a two-way job in %v mode proposed %v for %q", mode, a.Kind, a.Path)
			}
		}
	}
}

func TestParseModeFallsBackToTheModeThatDeletesNothing(t *testing.T) {
	for _, text := range []string{"", "MIRROR", "shred", "two-way"} {
		if got := ParseMode(text); got != ModeSync {
			t.Errorf("ParseMode(%q) = %v, want the mode that deletes nothing on its own", text, got)
		}
	}
	if ParseMode("mirror") != ModeMirror || ParseMode("move") != ModeMove {
		t.Error("the two spellings the interface writes are not recognised")
	}
}
