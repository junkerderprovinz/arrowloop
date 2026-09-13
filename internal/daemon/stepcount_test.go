package daemon

import (
	"sync"
	"testing"
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

	if got := steps.takeAndReset(); got != 0 {
		t.Errorf("a fresh counter read %d, want 0", got)
	}

	for i := 0; i < 5; i++ {
		steps.add()
	}
	if got := steps.takeAndReset(); got != 5 {
		t.Errorf("read %d after five steps, want 5", got)
	}
	// EMPTIED by the read, which is the whole contract: a tick sees what
	// happened since the last tick, never a total that only ever grows and
	// would mute the reading forever after a busy start.
	if got := steps.takeAndReset(); got != 0 {
		t.Errorf("read %d on the second read, want 0", got)
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
				steps.add()
			}
		}()
	}
	wg.Wait()

	if got := steps.takeAndReset(); got != workers*each {
		t.Errorf("counted %d, want %d", got, workers*each)
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
