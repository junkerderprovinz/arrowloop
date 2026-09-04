package plan

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/reeveroll/internal/scan"
	"github.com/junkerderprovinz/reeveroll/internal/state"
)

var base = time.Unix(1700000000, 0).UTC()

// live builds an entry as a side would report it now. The hash stays empty on
// purpose: these cases exercise the size-and-time fallback, which is the path
// a hashless backend such as plain SFTP takes, and therefore the path most
// likely to be wrong.
func live(path string, size int64, offset time.Duration) *scan.Entry {
	return &scan.Entry{Path: path, Size: size, Mod: base.Add(offset)}
}

func agreed(path string, leftSize, rightSize int64, leftOff, rightOff time.Duration) state.Entry {
	return state.Entry{
		Path:      path,
		LeftSize:  leftSize,
		LeftMod:   base.Add(leftOff),
		RightSize: rightSize,
		RightMod:  base.Add(rightOff),
	}
}

// TestDecisionTable walks every reachable combination of "what happened on the
// left" against "what happened on the right". These eleven rows are the whole
// engine; everything else is plumbing around them.
func TestDecisionTable(t *testing.T) {
	opt := Options{ModWindow: 2 * time.Second} // brake off, tested separately

	cases := []struct {
		name    string
		left    scan.Side
		right   scan.Side
		prev    map[string]state.Entry
		want    []Action
		agreedN int
		unchgd  int
	}{
		{
			name:   "both sides untouched",
			left:   scan.Side{"a.txt": live("a.txt", 10, 0)},
			right:  scan.Side{"a.txt": live("a.txt", 10, 0)},
			prev:   map[string]state.Entry{"a.txt": agreed("a.txt", 10, 10, 0, 0)},
			unchgd: 1,
		},
		{
			name:  "new on the left only",
			left:  scan.Side{"a.txt": live("a.txt", 10, 0)},
			right: scan.Side{},
			prev:  map[string]state.Entry{},
			want:  []Action{{Kind: Copy, Path: "a.txt", Src: Left, Dst: Right}},
		},
		{
			name:  "new on the right only",
			left:  scan.Side{},
			right: scan.Side{"a.txt": live("a.txt", 10, 0)},
			prev:  map[string]state.Entry{},
			want:  []Action{{Kind: Copy, Path: "a.txt", Src: Right, Dst: Left}},
		},
		{
			name:    "appeared on both sides, identical",
			left:    scan.Side{"a.txt": live("a.txt", 10, 0)},
			right:   scan.Side{"a.txt": live("a.txt", 10, 0)},
			prev:    map[string]state.Entry{},
			agreedN: 1,
		},
		{
			name:  "appeared on both sides, different",
			left:  scan.Side{"a.txt": live("a.txt", 10, 0)},
			right: scan.Side{"a.txt": live("a.txt", 99, 0)},
			prev:  map[string]state.Entry{},
			want:  []Action{{Kind: Conflict, Path: "a.txt"}},
		},
		{
			name:  "changed on the left only",
			left:  scan.Side{"a.txt": live("a.txt", 20, 0)},
			right: scan.Side{"a.txt": live("a.txt", 10, 0)},
			prev:  map[string]state.Entry{"a.txt": agreed("a.txt", 10, 10, 0, 0)},
			want:  []Action{{Kind: Copy, Path: "a.txt", Src: Left, Dst: Right}},
		},
		{
			name:  "changed on the right only",
			left:  scan.Side{"a.txt": live("a.txt", 10, 0)},
			right: scan.Side{"a.txt": live("a.txt", 20, 0)},
			prev:  map[string]state.Entry{"a.txt": agreed("a.txt", 10, 10, 0, 0)},
			want:  []Action{{Kind: Copy, Path: "a.txt", Src: Right, Dst: Left}},
		},
		{
			name:  "changed on both sides differently",
			left:  scan.Side{"a.txt": live("a.txt", 20, 0)},
			right: scan.Side{"a.txt": live("a.txt", 30, 0)},
			prev:  map[string]state.Entry{"a.txt": agreed("a.txt", 10, 10, 0, 0)},
			want:  []Action{{Kind: Conflict, Path: "a.txt"}},
		},
		{
			name:  "deleted on the left, untouched on the right",
			left:  scan.Side{"keep.txt": live("keep.txt", 5, 0)},
			right: scan.Side{"keep.txt": live("keep.txt", 5, 0), "a.txt": live("a.txt", 10, 0)},
			prev: map[string]state.Entry{
				"keep.txt": agreed("keep.txt", 5, 5, 0, 0),
				"a.txt":    agreed("a.txt", 10, 10, 0, 0),
			},
			want:   []Action{{Kind: Delete, Path: "a.txt", Dst: Right}},
			unchgd: 1,
		},
		{
			name:  "deleted on the right, untouched on the left",
			left:  scan.Side{"keep.txt": live("keep.txt", 5, 0), "a.txt": live("a.txt", 10, 0)},
			right: scan.Side{"keep.txt": live("keep.txt", 5, 0)},
			prev: map[string]state.Entry{
				"keep.txt": agreed("keep.txt", 5, 5, 0, 0),
				"a.txt":    agreed("a.txt", 10, 10, 0, 0),
			},
			want:   []Action{{Kind: Delete, Path: "a.txt", Dst: Left}},
			unchgd: 1,
		},
		{
			name:  "gone from both sides",
			left:  scan.Side{"keep.txt": live("keep.txt", 5, 0)},
			right: scan.Side{"keep.txt": live("keep.txt", 5, 0)},
			prev: map[string]state.Entry{
				"keep.txt": agreed("keep.txt", 5, 5, 0, 0),
				"a.txt":    agreed("a.txt", 10, 10, 0, 0),
			},
			want:   []Action{{Kind: Delete, Path: "a.txt", Dst: Left}},
			unchgd: 1,
		},
		{
			// An edit is evidence somebody wanted the file. A deletion that
			// silently wins over an edit is the failure mode users never
			// forgive, because the edit is the thing that cannot be recovered
			// from the other side.
			name:  "deleted on the left but edited on the right",
			left:  scan.Side{"keep.txt": live("keep.txt", 5, 0)},
			right: scan.Side{"keep.txt": live("keep.txt", 5, 0), "a.txt": live("a.txt", 42, time.Hour)},
			prev: map[string]state.Entry{
				"keep.txt": agreed("keep.txt", 5, 5, 0, 0),
				"a.txt":    agreed("a.txt", 10, 10, 0, 0),
			},
			want:   []Action{{Kind: Copy, Path: "a.txt", Src: Right, Dst: Left}},
			unchgd: 1,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Build(context.Background(), tc.left, tc.right, tc.prev, opt)
			if err != nil {
				t.Fatalf("build: %v", err)
			}
			if len(got.Actions) != len(tc.want) {
				t.Fatalf("got %d actions, want %d: %+v", len(got.Actions), len(tc.want), got.Actions)
			}
			for i, want := range tc.want {
				have := got.Actions[i]
				if have.Kind != want.Kind || have.Path != want.Path {
					t.Errorf("action %d: got %v %q, want %v %q", i, have.Kind, have.Path, want.Kind, want.Path)
					continue
				}
				if want.Kind == Copy && (have.Src != want.Src || have.Dst != want.Dst) {
					t.Errorf("action %d: got %v -> %v, want %v -> %v", i, have.Src, have.Dst, want.Src, want.Dst)
				}
				if want.Kind == Delete && have.Dst != want.Dst {
					t.Errorf("action %d: delete on %v, want %v", i, have.Dst, want.Dst)
				}
			}
			if len(got.Agreed) != tc.agreedN {
				t.Errorf("got %d agreed, want %d", len(got.Agreed), tc.agreedN)
			}
			if got.Unchanged != tc.unchgd {
				t.Errorf("got %d unchanged, want %d", got.Unchanged, tc.unchgd)
			}
		})
	}
}

// TestEmptySideRefused covers the classic total loss: a disk that failed to
// mount lists nothing, which reads as "everything was deleted".
func TestEmptySideRefused(t *testing.T) {
	prev := map[string]state.Entry{}
	left := scan.Side{}
	right := scan.Side{}
	for i := range 20 {
		p := string(rune('a'+i)) + ".txt"
		prev[p] = agreed(p, 10, 10, 0, 0)
		left[p] = live(p, 10, 0)
	}

	_, err := Build(context.Background(), left, right, prev, DefaultOptions())
	var empty *EmptySideError
	if err == nil {
		t.Fatal("an empty right side was accepted; that is the data-loss case")
	}
	if !asEmpty(err, &empty) {
		t.Fatalf("got %v, want an EmptySideError", err)
	}
	if empty.Side != Right {
		t.Errorf("blamed the %v side, want right", empty.Side)
	}
}

// TestBrakeTrips proves the brake fires on a plausible-looking but excessive
// deletion, and that it does not fire on an ordinary one.
func TestBrakeTrips(t *testing.T) {
	build := func(deleteCount int) error {
		prev := map[string]state.Entry{}
		left := scan.Side{}
		right := scan.Side{}
		for i := range 40 {
			p := string(rune('a'+i%26)) + string(rune('a'+i/26)) + ".txt"
			prev[p] = agreed(p, 10, 10, 0, 0)
			right[p] = live(p, 10, 0)
			if i >= deleteCount {
				left[p] = live(p, 10, 0)
			}
		}
		_, err := Build(context.Background(), left, right, prev, DefaultOptions())
		return err
	}

	if err := build(5); err != nil {
		t.Errorf("deleting 5 of 40 should pass the brake, got %v", err)
	}
	err := build(30)
	if err == nil {
		t.Fatal("deleting 30 of 40 should have tripped the brake")
	}
	var brake *BrakeError
	if !asBrake(err, &brake) {
		t.Fatalf("got %v, want a BrakeError", err)
	}
	if brake.Deletes != 30 {
		t.Errorf("brake counted %d deletions, want 30", brake.Deletes)
	}
}

func asEmpty(err error, target **EmptySideError) bool {
	e, ok := err.(*EmptySideError)
	if ok {
		*target = e
	}
	return ok
}

func asBrake(err error, target **BrakeError) bool {
	e, ok := err.(*BrakeError)
	if ok {
		*target = e
	}
	return ok
}
