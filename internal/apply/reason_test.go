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

// TestEveryReasonThisPackageGivesIsWorded walks the reason codes the apply
// stage produces and demands an English sentence for each.
//
// A code with no wording used to answer with an empty string, so a run printed
// a path, a colon and nothing. Three codes the engine really produces were in
// exactly that state, and none of them was in this package: goneBoth,
// appearedSame and appearedDiffer, which is what a plain delete and a pair of
// folders that already match report. They are checked here too.
//
// The test lives in this package and not in plan's own, which is where the
// vocabulary lives, only because the file ownership for this change did not
// extend to adding a file there. It reaches the same map through the same
// exported constructor, so it fails for the same reasons; it is simply in the
// wrong room.
func TestEveryReasonThisPackageGivesIsWorded(t *testing.T) {
	codes := []string{
		// Given while a run is running.
		"stepFailed", "removeDirFailed", "recordFailed",
		"heldOpen", "heldOpenDuring", "unverified",
		// Given while a run is deciding. The three that were silent.
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

// TestAnUnwordedCodeAnswersWithItself pins the fallback the vocabulary's own
// comment promised and did not have.
//
// The empty string is the dangerous answer here, not the ugly one. A blank
// reason is indistinguishable from a reason that had nothing to add, so a
// missing sentence stays missing for as long as nobody happens to read the
// map. The code itself is ugly and impossible to miss.
func TestAnUnwordedCodeAnswersWithItself(t *testing.T) {
	r := plan.Because("noSuchReasonHasEverBeenWorded", "side", "left")
	if r.Text != "noSuchReasonHasEverBeenWorded" {
		t.Errorf("an unworded code answered with %q, wanted the code itself", r.Text)
	}
	if r.String() == "" {
		t.Error("an unworded code printed as nothing, which is the failure this guard exists for")
	}
}

// TestWhyFailedTellsTheThreeFailuresApart is the guard for [2502] and [2504] at
// the point where they meet: one error value, three different things to say.
func TestWhyFailedTellsTheThreeFailuresApart(t *testing.T) {
	t.Run("an ordinary failure keeps its own code", func(t *testing.T) {
		r := whyFailed(Ends{}, nil, "copy", "stepFailed", errors.New("no space left on device"))
		if r.Code != "stepFailed" {
			t.Errorf("recorded as %q, wanted stepFailed", r.Code)
		}
		// The backend's own words have to survive. A reason that summarises
		// them away leaves the reader with nothing to search for.
		if want := "no space left on device"; r.Vars["error"] != want {
			t.Errorf("the error text became %q, wanted %q", r.Vars["error"], want)
		}
	})

	t.Run("the fallback code is not hard-wired to stepFailed", func(t *testing.T) {
		// "The folder could not be removed" and "the copy failed" send the
		// reader to different places, and collapsing them was a real
		// temptation while writing this.
		r := whyFailed(Ends{}, nil, "removing the folder", "removeDirFailed", errors.New("directory not empty"))
		if r.Code != "removeDirFailed" {
			t.Errorf("recorded as %q, wanted removeDirFailed", r.Code)
		}
	})

	t.Run("a file another program is holding is not a failure", func(t *testing.T) {
		// Errno 32 is ERROR_SHARING_VIOLATION on Windows, which is the whole
		// point of this branch, and EPIPE on POSIX, which is not a lock and
		// must not be read as one. The expectation therefore differs by
		// platform, deliberately: the state this guard protects against cannot
		// be reached at all away from Windows, and a test that pretended
		// otherwise would be asserting a fiction.
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
		// Wrapped, because the error travels up through one() and forEach
		// before anybody classifies it, and errors.As is the only thing that
		// survives that journey.
		if r.Vars["side"] != "right" {
			t.Errorf("the reason names the %q side, wanted right", r.Vars["side"])
		}
	})
}

// TestOnlyFinishedWorkMovesTheProgressBar guards the arithmetic behind the bar.
//
// The total is counted before anything moves, from the transfers in the plan. A
// skip is work postponed rather than done, and a remark about how a file was
// verified is not a second transfer, so neither may advance the count. Sending
// either through note() would walk the bar past its own total, and a bar
// reading 106 of 100 is worse than no bar at all.
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
		{"a postponed file does not", func(tal *tally) { tal.skip("notes.txt", plan.Because("heldOpen", "side", "left")) }},
		{"a remark about a file does not", func(tal *tally) { tal.observe("unverified", "notes.txt", "right", "no checksum") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var tal tally
			tc.do(&tal)
			if tal.done != 0 {
				t.Errorf("the bar moved to %d for something that was not a piece of work", tal.done)
			}
			// It still has to be WRITTEN DOWN. Not counting it and not
			// recording it are two different decisions, and only the first one
			// was made here.
			if len(tal.res.Entries) != 1 {
				t.Errorf("the run's list holds %d lines, so the thing that happened went unrecorded", len(tal.res.Entries))
			}
		})
	}
}

// TestWantsToTouchCoversEveryKindOfWork is the guard that a locked file is
// looked for at all.
//
// The probe used to ask about copies and nothing else, so a rename of an open
// document, a conflict between two open documents and a deletion of one all
// reported a raw Win32 sentence under the generic failure code. Each line below
// is one of those three going unnoticed again.
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
			// The file being renamed is on the FAR side under its old name: a
			// rename is applied over there, not carried across. Probing the
			// source instead would ask about a file nobody is going to touch.
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
			// Nothing is on either side, so there is no file to lock and only
			// a state row to clear. Probing here would open nothing and slow
			// down the one action that touches no filesystem at all.
			name: "a record cleanup touches nothing",
			act:  plan.Action{Kind: plan.Delete, Dst: plan.Left},
			want: nil,
		},
		{
			// Both, and this is the case that makes the answer a list. The
			// manoeuvre moves one version aside and copies in both directions,
			// so a lock on either side stops it halfway through something that
			// is only safe as a whole.
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

// TestTheDestinationIsOnlySuspectedAfterAFailure pins the one difference
// between the two lists, which is the whole reason there are two.
//
// A destination is not probed beforehand: it means opening a file the run is
// about to overwrite, for an answer the attempt gives anyway. It IS asked about
// afterwards, and it has to be, because rclone writes a temporary file and
// renames it into place, and Windows refuses that rename onto a held file with
// a plain access denial. Access denied is also a genuine permission problem, so
// the error number cannot decide it and the file has to be asked.
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

	// A deletion has no destination to write over: the file named IS the
	// victim, and listing it twice would probe the same path twice on every
	// failed deletion.
	del := plan.Action{Kind: plan.Delete, Dst: plan.Right, DstPath: "notes.txt", RightNow: &scan.Entry{Path: "notes.txt"}}
	if got := couldHaveLocked(del); len(got) != 1 {
		t.Errorf("a failed deletion probes %v, wanted the victim once", got)
	}
}
