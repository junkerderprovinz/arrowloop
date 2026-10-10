package plan

import (
	"context"
	"fmt"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// tree is forty files both sides agreed on, of which the left has since
// deleted some and rewritten others.
func tree(deleted, changed int) (left, right scan.Side, prev map[string]state.Entry) {
	left, right, prev = scan.Side{}, scan.Side{}, map[string]state.Entry{}
	for i := range 40 {
		p := fmt.Sprintf("f%02d.txt", i)
		prev[p] = agreed(p, 10, 10, 0, 0)
		right[p] = live(p, 10, 0)
		switch {
		case i < deleted:
		case i < deleted+changed:
			left[p] = live(p, 99, 0)
		default:
			left[p] = live(p, 10, 0)
		}
	}
	return left, right, prev
}

func refused(t *testing.T, left, right scan.Side, prev map[string]state.Entry, opt Options) *BrakeError {
	t.Helper()
	_, err := Build(context.Background(), listing(left), listing(right), prev, opt)
	var brake *BrakeError
	if !asBrake(err, &brake) {
		t.Fatalf("got %v, want a brake to refuse", err)
	}
	return brake
}

func TestChangeBrakeTrips(t *testing.T) {
	left, right, prev := tree(0, 5)
	if _, err := Build(context.Background(), listing(left), listing(right), prev, noQuiet()); err != nil {
		t.Errorf("overwriting 5 of 40 should pass the brake, got %v", err)
	}

	left, right, prev = tree(0, 30)
	brake := refused(t, left, right, prev, noQuiet())
	if brake.Kind != BrakeChange || brake.Count != 30 || brake.OnRight != 30 {
		t.Errorf("the %s brake counted %d, %d of them on the right; want 30 overwrites, all on the right",
			brake.Kind, brake.Count, brake.OnRight)
	}
	if len(brake.Paths) != 30 {
		t.Errorf("the refusal names %d files, want all 30", len(brake.Paths))
	}

	off := noQuiet()
	off.ChangePercent = 0
	if _, err := Build(context.Background(), listing(left), listing(right), prev, off); err != nil {
		t.Errorf("a brake set to zero refused anyway: %v", err)
	}
}

func TestNewFilesAreNoChange(t *testing.T) {
	left, right, prev := tree(0, 0)
	for i := range 60 {
		p := fmt.Sprintf("new%02d.txt", i)
		left[p] = live(p, 10, 0)
	}
	if _, err := Build(context.Background(), listing(left), listing(right), prev, noQuiet()); err != nil {
		t.Errorf("sixty new files tripped a brake: %v", err)
	}
}

func TestApprovalCoversOnlyWhatWasShown(t *testing.T) {
	left, right, prev := tree(30, 0)
	shown := refused(t, left, right, prev, noQuiet())

	opt := noQuiet()
	opt.Approved = []string{shown.Mark}
	if _, err := Build(context.Background(), listing(left), listing(right), prev, opt); err != nil {
		t.Fatalf("the approved change was refused again: %v", err)
	}

	// One more file went since the approval was given.
	delete(left, "f35.txt")
	again := refused(t, left, right, prev, opt)
	if again.Mark == shown.Mark {
		t.Error("a different set of deletions carries the same mark")
	}
}

func TestApprovedEmptySideDeletesTheOther(t *testing.T) {
	_, right, prev := tree(0, 0)
	_, err := Build(context.Background(), listing(scan.Side{}), listing(right), prev, noQuiet())
	var empty *EmptySideError
	if !asEmpty(err, &empty) {
		t.Fatalf("got %v, want the empty side refused", err)
	}

	opt := noQuiet()
	opt.Approved = []string{empty.Mark()}
	p, err := Build(context.Background(), listing(scan.Side{}), listing(right), prev, opt)
	if err != nil {
		t.Fatalf("the accepted empty side was refused: %v", err)
	}
	if len(p.Actions) != 40 || p.Actions[0].Kind != Delete || p.Actions[0].Dst != Right {
		t.Errorf("got %d actions starting with %v on the %v, want 40 deletions on the right",
			len(p.Actions), p.Actions[0].Kind, p.Actions[0].Dst)
	}
}

func TestTakeBackReversesWhatWasRefused(t *testing.T) {
	left, right, prev := tree(12, 14)
	opt := noQuiet()
	opt.Unbraked = true
	p, err := Build(context.Background(), listing(left), listing(right), prev, opt)
	if err != nil {
		t.Fatalf("an unbraked plan was refused: %v", err)
	}

	gone := TakeBack(p, BrakeDelete)
	if len(gone.Actions) != 12 {
		t.Fatalf("took back %d deletions, want 12", len(gone.Actions))
	}
	for _, a := range gone.Actions {
		if a.Kind != Copy || a.Src != Right || a.Dst != Left || a.SrcPath != a.Path || a.DstPath != a.Path {
			t.Fatalf("%q comes back as %v from the %v to the %v, want a copy from the right to the left", a.Path, a.Kind, a.Src, a.Dst)
		}
	}

	edited := TakeBack(p, BrakeChange)
	if len(edited.Actions) != 14 {
		t.Fatalf("took back %d overwrites, want 14", len(edited.Actions))
	}
	for _, a := range edited.Actions {
		if a.Kind != Copy || a.Src != Right || a.Dst != Left {
			t.Fatalf("%q comes back as %v from the %v, want the right side's version copied over the left", a.Path, a.Kind, a.Src)
		}
	}
}

func TestTakeBackOfAnEmptySideRefillsIt(t *testing.T) {
	_, right, prev := tree(0, 0)
	opt := noQuiet()
	opt.Unbraked = true
	p, err := Build(context.Background(), listing(scan.Side{}), listing(right), prev, opt)
	if err != nil {
		t.Fatalf("an unbraked plan was refused: %v", err)
	}
	back := TakeBack(p, BrakeEmpty)
	if len(back.Actions) != 40 || back.Actions[0].Dst != Left {
		t.Errorf("got %d copies towards the %v, want 40 towards the left", len(back.Actions), back.Actions[0].Dst)
	}
}
