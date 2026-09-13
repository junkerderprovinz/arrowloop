package daemon

import (
	"sync"
	"testing"
	"time"
)

// The counter that keeps an expensive reading out of a hot run.
//
// Measured on jdp's phone: the same job over 600 files took 9.0 seconds with
// the in-flight reading off and 25.6 with it on, twice a second. `RemoteStats`
// takes the lock every byte of every transfer also takes, so asking while four
// workers push small files makes the accounting queue behind the question.
//
// The counter is what tells the two cases apart. A tick in which many steps
// finished is a tick whose files were done before a bar could have moved; a
// tick in which none did is a big file, which is the only case the display was
// ever for.
func TestTheCounterEmptiesWhenItIsRead(t *testing.T) {
	var steps stepCount

	if got, files := steps.takeAndReset(); got != 0 || files != 0 {
		t.Errorf("a fresh counter read %d steps and %d files, want 0 and 0", got, files)
	}

	for i := 0; i < 5; i++ {
		steps.add("copy")
	}
	if got, files := steps.takeAndReset(); got != 5 || files != 5 {
		t.Errorf("read %d steps and %d files after five copies, want 5 and 5", got, files)
	}
	// EMPTIED by the read, which is the whole contract: a tick sees what
	// happened since the last tick, never a total that only ever grows and
	// would mute the reading forever after a busy start.
	if got, files := steps.takeAndReset(); got != 0 || files != 0 {
		t.Errorf("read %d steps and %d files on the second read, want 0 and 0", got, files)
	}
}

// Only the kinds that move bytes reach the rate.
//
// The gate and the caption read the SAME counter and want different things
// from it. A run making folders is busy, so the expensive reading stays off;
// but "180 a second" under a job, when not one file has moved, describes work
// nobody was watching for. Getting this wrong is invisible in a copy-only run,
// which is every test that came before this one.
func TestOnlyTransfersCountTowardTheRate(t *testing.T) {
	var steps stepCount
	for _, kind := range []string{"mkdir", "record", "rmdir", "conflict", "trash"} {
		steps.add(kind)
	}
	steps.add("copy")
	steps.add("move")

	count, files := steps.takeAndReset()
	if count != 7 {
		t.Errorf("the gate saw %d steps, want all 7 - a busy run is busy whatever it is doing", count)
	}
	if files != 2 {
		t.Errorf("the rate saw %d files, want 2 - only copy and move moved bytes", files)
	}
}

// The rate is worked out from the time that actually passed.
//
// A phone under load delivers a tick late, and a rate divided by the interval
// that was ASKED for would then claim more files a second than the run managed.
func TestTheRateUsesTheSpanThatActuallyPassed(t *testing.T) {
	for _, c := range []struct {
		name  string
		count int
		over  time.Duration
		want  int
	}{
		{"half a second of work", 120, 500 * time.Millisecond, 240},
		{"a tick that came late", 120, time.Second, 120},
		{"rounded to the nearest whole file", 3, 2 * time.Second, 2},
		{"nothing moved", 0, 500 * time.Millisecond, 0},
		{"a clock that stepped backwards", 40, -time.Second, 0},
		{"no time at all", 40, 0, 0},
	} {
		if got := perSecond(c.count, c.over); got != c.want {
			t.Errorf("%s: %d over %s read as %d a second, want %d", c.name, c.count, c.over, got, c.want)
		}
	}
}

// Several workers finish steps at once, so the counter is written from several
// goroutines and read from the ticker. Under `-race` this is the test that
// says so.
func TestTheCounterSurvivesEveryWorkerAtOnce(t *testing.T) {
	var steps stepCount
	var wg sync.WaitGroup
	const workers, each = 8, 500

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < each; j++ {
				steps.add("copy")
			}
		}()
	}
	wg.Wait()

	if got, files := steps.takeAndReset(); got != workers*each || files != workers*each {
		t.Errorf("counted %d steps and %d files, want %d of each", got, files, workers*each)
	}
}

// A progress watcher without a counter must not panic.
//
// Nil is the ordinary state in every caller that does not publish in-flight
// frames, and a run is not the place to find out that a field was optional.
func TestAProgressWatcherWithoutACounterStillWorks(t *testing.T) {
	// Built directly rather than through New, which wants a configuration on
	// disk. What is under test is the optional field, not the constructor.
	watcher := progressFor{runner: &Runner{}, job: "Fotos"}
	// Nobody is subscribed, so this only has to not blow up.
	watcher.Starting(3)
	watcher.Did("copy", "a.jpg", "right", 1, 3)
}
