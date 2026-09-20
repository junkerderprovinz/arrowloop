package daemon

import (
	"sync"
	"testing"
	"time"
)

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
	// A growing total would mute the reading for ever after a busy start.
	if got, files := steps.takeAndReset(); got != 0 || files != 0 {
		t.Errorf("read %d steps and %d files on the second read, want 0 and 0", got, files)
	}
}

// A run making folders is busy, but only the kinds that move bytes reach the
// rate.
func TestOnlyTransfersCountTowardTheRate(t *testing.T) {
	var steps stepCount
	for _, kind := range []string{"mkdir", "record", "rmdir", "conflict", "trash"} {
		steps.add(kind)
	}
	steps.add("copy")
	steps.add("move")

	count, files := steps.takeAndReset()
	if count != 7 {
		t.Errorf("the gate saw %d steps, want all 7; a busy run is busy whatever it is doing", count)
	}
	if files != 2 {
		t.Errorf("the rate saw %d files, want 2; only copy and move moved bytes", files)
	}
}

// A phone under load delivers a tick late.
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

// Several workers write the counter at once; run under -race.
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

func TestAProgressWatcherWithoutACounterStillWorks(t *testing.T) {
	// Built directly, since New wants a configuration on disk.
	watcher := progressFor{runner: &Runner{}, job: "Fotos"}
	watcher.Starting(3)
	watcher.Did("copy", "a.jpg", "right", 1, 3)
}
