package apply

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"syscall"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// Every reason code the engine gives, including three the planner gives for a
// plain delete and matching folders, needs an English sentence.
func TestEveryReasonThisPackageGivesIsWorded(t *testing.T) {
	codes := []string{
		// Given while a run is running.
		"stepFailed", "removeDirFailed", "recordFailed",
		"heldOpen", "heldOpenDuring", "unverified",
		// Given while a run is deciding.
		"goneBoth", "appearedSame", "appearedDiffer",
	}
	for _, code := range codes {
		r := plan.Because(code, "side", "left", "what", "copy", "error", "boom")
		if r.Text == "" {
			t.Errorf("%q has no sentence, so a run reporting it says nothing at all", code)
		}
		if r.Text == code {
			t.Errorf("%q fell back to its own code, so nobody has worded it: %q", code, r.Text)
		}
	}
}

// A blank reason could not be told from one with nothing to add, so a missing
// sentence falls back to the code, which nobody can miss.
func TestAnUnwordedCodeAnswersWithItself(t *testing.T) {
	r := plan.Because("noSuchReasonHasEverBeenWorded", "side", "left")
	if r.Text != "noSuchReasonHasEverBeenWorded" {
		t.Errorf("an unworded code answered with %q, wanted the code itself", r.Text)
	}
	if r.String() == "" {
		t.Error("an unworded code printed as nothing")
	}
}

func TestWhyFailedTellsTheThreeFailuresApart(t *testing.T) {
	t.Run("an ordinary failure keeps its own code", func(t *testing.T) {
		r := whyFailed(Ends{}, nil, "copy", "stepFailed", errors.New("no space left on device"))
		if r.Code != "stepFailed" {
			t.Errorf("recorded as %q, wanted stepFailed", r.Code)
		}
		// The backend's own words are what the reader can search for.
		if want := "no space left on device"; r.Vars["error"] != want {
			t.Errorf("the error text became %q, wanted %q", r.Vars["error"], want)
		}
	})

	t.Run("the fallback code is not hard-wired to stepFailed", func(t *testing.T) {
		// "The folder could not be removed" and "the copy failed" send the
		// reader to different places.
		r := whyFailed(Ends{}, nil, "removing the folder", "removeDirFailed", errors.New("directory not empty"))
		if r.Code != "removeDirFailed" {
			t.Errorf("recorded as %q, wanted removeDirFailed", r.Code)
		}
	})

	t.Run("a file another program is holding is not a failure", func(t *testing.T) {
		// Errno 32 is ERROR_SHARING_VIOLATION on Windows and EPIPE on POSIX,
		// which is not a lock, so the expectation differs by platform.
		err := &os.PathError{Op: "open", Path: "notes.txt", Err: syscall.Errno(32)}
		want := "stepFailed"
		if runtime.GOOS == "windows" {
			want = "heldOpenDuring"
		}
		if r := whyFailed(Ends{}, nil, "copy", "stepFailed", err); r.Code != want {
			t.Errorf("on %s a sharing violation was recorded as %q, wanted %q", runtime.GOOS, r.Code, want)
		}
	})

	t.Run("an unproven agreement is its own reason and names the side", func(t *testing.T) {
		err := fmt.Errorf("wrapped: %w", &UnverifiedError{Path: "notes.txt", Side: plan.Right, Err: errors.New("no checksums here")})
		r := whyFailed(Ends{}, nil, "copy", "stepFailed", err)
		if r.Code != "unverified" {
			t.Errorf("recorded as %q, wanted unverified", r.Code)
		}
		// Wrapped, as it is after travelling up through one and forEach.
		if r.Vars["side"] != "right" {
			t.Errorf("the reason names the %q side, wanted right", r.Vars["side"])
		}
	})
}

// The total is counted from the plan before anything moves, so a skip or a
// remark about a file must not advance the count.
func TestOnlyFinishedWorkMovesTheProgressBar(t *testing.T) {
	t.Run("a finished piece of work does", func(t *testing.T) {
		var tal tally
		tal.step("copy", "notes.txt", "right")
		if tal.done != 1 {
			t.Errorf("a finished copy left the bar at %d, so it never moves at all", tal.done)
		}
	})

	for _, tc := range []struct {
		name string
		do   func(*tally)
	}{
		{"a postponed file does not", func(tal *tally) { tal.skip("notes.txt", "right", plan.Because("heldOpen", "side", "left")) }},
		{"a remark about a file does not", func(tal *tally) { tal.observe("unverified", "notes.txt", "right", "no checksum") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var tal tally
			tc.do(&tal)
			if tal.done != 0 {
				t.Errorf("the bar moved to %d for something that was not a piece of work", tal.done)
			}
			// Not counted, but still recorded.
			if len(tal.res.Entries) != 1 {
				t.Errorf("the run's list holds %d lines, so the thing that happened went unrecorded", len(tal.res.Entries))
			}
		})
	}
}

func TestWantsToTouchCoversEveryKindOfWork(t *testing.T) {
	left := &scan.Entry{Path: "notes.txt"}
	right := &scan.Entry{Path: "Notes.txt"}

	for _, tc := range []struct {
		name string
		act  plan.Action
		want []touch
	}{
		{
			name: "a copy reads its source",
			act:  plan.Action{Kind: plan.Copy, Src: plan.Left, Dst: plan.Right, SrcPath: "notes.txt", DstPath: "notes.txt"},
			want: []touch{{plan.Left, "notes.txt"}},
		},
		{
			// A rename is applied on the far side, to the old name.
			name: "a rename touches the far side's old name",
			act:  plan.Action{Kind: plan.Move, Src: plan.Left, Dst: plan.Right, DstPath: "new.txt", OldDstPath: "old.txt"},
			want: []touch{{plan.Right, "old.txt"}},
		},
		{
			name: "a deletion touches the file it is about to bin",
			act:  plan.Action{Kind: plan.Delete, Dst: plan.Right, DstPath: "notes.txt", RightNow: right},
			want: []touch{{plan.Right, "notes.txt"}},
		},
		{
			// Nothing is on either side; only a state row is cleared.
			name: "a record cleanup touches nothing",
			act:  plan.Action{Kind: plan.Delete, Dst: plan.Left},
			want: nil,
		},
		{
			name: "a conflict touches a real file on each side",
			act:  plan.Action{Kind: plan.Conflict, LeftNow: left, RightNow: right},
			want: []touch{{plan.Left, "notes.txt"}, {plan.Right, "Notes.txt"}},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := wantsToTouch(tc.act)
			if len(got) != len(tc.want) {
				t.Fatalf("probes %v, wanted %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("probe %d is %v, wanted %v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// See couldHaveLocked for why the destination is only asked about afterwards.
func TestTheDestinationIsOnlySuspectedAfterAFailure(t *testing.T) {
	act := plan.Action{Kind: plan.Copy, Src: plan.Left, Dst: plan.Right, SrcPath: "notes.txt", DstPath: "notes.txt"}

	for _, w := range wantsToTouch(act) {
		if w.side == plan.Right {
			t.Errorf("the destination is opened before the copy is even attempted: %v", w)
		}
	}

	var sawDestination bool
	for _, w := range couldHaveLocked(act) {
		if w.side == plan.Right && w.path == "notes.txt" {
			sawDestination = true
		}
	}
	if !sawDestination {
		t.Errorf("a failed copy never asks its destination, so the commonest lock of all stays anonymous: %v", couldHaveLocked(act))
	}

	// A deletion's destination is the file it removes, listed once.
	del := plan.Action{Kind: plan.Delete, Dst: plan.Right, DstPath: "notes.txt", RightNow: &scan.Entry{Path: "notes.txt"}}
	if got := couldHaveLocked(del); len(got) != 1 {
		t.Errorf("a failed deletion probes %v, wanted the victim once", got)
	}
}

func TestSkipNamesTheSideItWouldHaveWritten(t *testing.T) {
	var tal tally
	tal.skip("notes.txt", "right", plan.Because("stepFailed", "what", "copy", "error", "timeout"))
	if len(tal.res.Entries) != 1 {
		t.Fatalf("got %d entries, want the one skip", len(tal.res.Entries))
	}
	if got := tal.res.Entries[0].Side; got != "right" {
		t.Errorf("skip recorded side %q, want right, so the log can tell an upload from a download", got)
	}
}
