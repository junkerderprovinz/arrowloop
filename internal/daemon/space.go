package daemon

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/precheck"
)

// ErrNotEnoughSpace stops a run that would not fit.
//
// Its own error, not a generic failure, because the caller has to be able to
// tell it apart: a run that was refused before it started left everything
// exactly as it was, and a run that stopped halfway did not. Those two need
// different words in the log and different reactions from a person.
var ErrNotEnoughSpace = errors.New("not enough room on the destination")

// roomFor refuses a run whose plan would not fit.
//
// The check itself lives in internal/precheck and is also reachable as a button.
// This is the other half of it, and the half that matters most: a person only
// presses the button when they are already worried, while the run that fills a
// disk is the one nobody was watching.
//
// What a full destination costs is worse than a failed run. rclone stops
// mid-transfer, so the tree ends up holding a partial file, and the state
// database is written per file as each one finishes: the record and the disk
// then disagree in a way only a full re-scan resolves. Refusing beforehand
// leaves both sides untouched.
//
// It deliberately does NOT run for a job started by hand. Somebody pressing the
// button with a full disk is somebody who will read the error, and a check that
// refuses to even try is the more annoying failure of the two when the estimate
// is wrong. The estimate is a floor rather than a peak (a copy that replaces a
// file can need the new bytes before the old ones are freed), so it can be too
// low but it can also be too cautious once retries are counted, and the clock
// is where caution belongs.
func (r *Runner) roomFor(ctx context.Context, j job.Job) error {
	return refusalFrom(precheck.Check(ctx, j, precheck.Opts{}))
}

// refusalFrom decides which of a report's findings actually stops a run.
//
// Its own function because it is the only part of this that can be checked
// without a disk that is genuinely full, and because it carries a real decision
// rather than plumbing: ONLY the space finding stops a scheduled run.
//
// Everything else precheck reports is either something the run itself will
// discover and say better, an unreachable side becomes a real error carrying the
// backend's own words, or something that is not a problem at all the first time,
// a side that does not exist yet is created by the very run being refused. A
// gate that turned every finding into a refusal would make the first run of
// every new job fail, which is the worst possible first impression and would
// have the switch turned off within a day.
func refusalFrom(report precheck.Report) error {
	if report.OK {
		return nil
	}
	var tight []string
	for _, f := range report.Findings {
		if f.Code == "notEnoughSpace" {
			tight = append(tight, f.Text)
		}
	}
	if len(tight) == 0 {
		return nil
	}
	return fmt.Errorf("%w: %s", ErrNotEnoughSpace, strings.Join(tight, "; "))
}
