package daemon

import (
	"os"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// seed applies a job's first-run choice, once, and only while it has no record.
//
// The first run is the one that decides everything and the one nobody is asked
// about. With no record, every file on both sides is new, so the engine merges:
// everything on the left arrives on the right and the other way round. That is
// the right default and it is frequently not what somebody wanted, and by the
// time they notice, the other side is full of files they meant to leave behind.
//
// The seed is expressed as a DIRECTION rather than as its own mode, because the
// rule it needs already exists and is already tested: a one-way job lets the
// source win every disagreement and leaves alone a file the source never had.
// Writing a second set of rules that happened to agree with those would be two
// chances to disagree later.
//
// Once the record exists this does nothing at all. A setting left behind in the
// file must not be able to quietly turn a two-way job into a one-way one.
func seed(j job.Job) job.Job {
	if j.FirstRun == "" || j.FirstRun == "merge" {
		return j
	}
	// The record's absence is the whole condition, so it is asked about the file
	// itself rather than about anything the engine reports. Opening the database
	// to find out would CREATE it, and the second run would then see a record
	// that the first run's own question had made.
	if _, err := os.Stat(j.State); err == nil {
		return j
	}
	switch j.FirstRun {
	case "left":
		j.Direction = "leftToRight"
	case "right":
		j.Direction = "rightToLeft"
	}
	return j
}
