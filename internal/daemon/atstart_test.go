package daemon

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

const nightly = "0 3 * * *"

func dueAtStart(name string) job.Job {
	return job.Job{Name: name, Schedule: nightly, RunAtStart: job.AtStartWhenDue}
}

func record(t *testing.T, r *Runner, name string, at time.Time, failure string) {
	t.Helper()
	run := history.Run{JobID: r.keyOf(name), Job: name, Started: at, Finished: at, Err: failure}
	if err := r.hist.Record(context.Background(), run, nil); err != nil {
		t.Fatalf("record: %v", err)
	}
}

// startRuns runs the start's pass and gives it time to run whatever it took on.
func startRuns(r *Runner) {
	r.runAtStart(context.Background())
	time.Sleep(time.Second)
}

func TestAJobWhoseTurnWentByWhileTheProgramWasOffRunsAtStart(t *testing.T) {
	r := requestRunner(t, dueAtStart("photos"))
	record(t, r, "photos", time.Now().AddDate(0, 0, -2), "")

	r.runAtStart(context.Background())
	waitForRuns(t, r, "photos", 2)
}

func TestAJobThatNeverRanIsDueAtStart(t *testing.T) {
	r := requestRunner(t, dueAtStart("photos"))

	r.runAtStart(context.Background())
	settled(t, r, "photos")
	if n := recordedRuns(t, r, "photos"); n != 1 {
		t.Errorf("%d runs recorded, want one at start", n)
	}
}

func TestAJobWhoseTurnHasNotComeWaitsAtStart(t *testing.T) {
	r := requestRunner(t, dueAtStart("photos"))
	record(t, r, "photos", time.Now(), "")

	startRuns(r)
	if n := recordedRuns(t, r, "photos"); n != 1 {
		t.Errorf("%d runs recorded, want only the earlier one", n)
	}
}

func TestAFailedJobWaitsOutItsRetryPauseAtStart(t *testing.T) {
	r := requestRunner(t, dueAtStart("photos"))
	record(t, r, "photos", time.Now().Add(-time.Minute), "the server did not answer")

	startRuns(r)
	if n := recordedRuns(t, r, "photos"); n != 1 {
		t.Errorf("%d runs recorded, want only the failed one", n)
	}
}

func TestAJobWithoutAScheduleIsNeverDueAtStart(t *testing.T) {
	j := dueAtStart("inbox")
	j.Schedule = ""
	r := requestRunner(t, j)

	startRuns(r)
	if n := recordedRuns(t, r, "inbox"); n != 0 {
		t.Errorf("the job ran %d times at start", n)
	}
}

func TestAJobSetToAlwaysRunsAtStartThoughItIsNotDue(t *testing.T) {
	j := dueAtStart("photos")
	j.RunAtStart = job.AtStartAlways
	r := requestRunner(t, j)
	record(t, r, "photos", time.Now(), "")

	r.runAtStart(context.Background())
	waitForRuns(t, r, "photos", 2)
}

// Jobs that are due together at start share one uplink and one disk, and a
// start-up burst is where that matters most, so they go one after another
// even where parallelJobs would let them overlap.
func TestJobsDueAtStartRunOneAfterAnother(t *testing.T) {
	r := requestRunner(t, dueAtStart("photos"), dueAtStart("music"))
	r.config().ParallelJobs = 2
	events, unsubscribe := r.Subscribe()
	defer unsubscribe()

	r.runAtStart(context.Background())
	going := 0
	finished := 0
	for finished < 2 {
		select {
		case ev := <-events:
			switch ev.Phase {
			case "started":
				going++
				if going > 1 {
					t.Fatal("two runs at start went at once")
				}
			case "finished":
				going--
				finished++
			}
		case <-time.After(30 * time.Second):
			t.Fatalf("%d of the two runs at start finished", finished)
		}
	}
}

func TestRunsAtStartWaitUntilTheyAreLetGo(t *testing.T) {
	r := requestRunner(t, dueAtStart("photos"))
	ready := make(chan struct{})
	r.HoldStartRuns(ready)

	startRuns(r)
	if n := recordedRuns(t, r, "photos"); n != 0 {
		t.Fatalf("the job ran %d times before the start was let go", n)
	}
	close(ready)
	settled(t, r, "photos")
}

func TestAStartWithoutRunsAtStartLeavesEveryJobToItsSchedule(t *testing.T) {
	j := dueAtStart("inbox")
	j.RunAtStart = job.AtStartAlways
	r := requestRunner(t, j, dueAtStart("photos"))
	r.SkipStartRuns()

	startRuns(r)
	for _, name := range []string{"inbox", "photos"} {
		if n := recordedRuns(t, r, name); n != 0 {
			t.Errorf("%s ran %d times at start", name, n)
		}
	}
}

func waitForRuns(t *testing.T, r *Runner, name string, want int) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for recordedRuns(t, r, name) < want {
		if time.Now().After(deadline) {
			t.Fatalf("%s has %d runs, want %d", name, recordedRuns(t, r, name), want)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
