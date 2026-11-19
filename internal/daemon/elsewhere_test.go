package daemon_test

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/joblock"
)

func TestAJobAnotherProcessRunsIsLeftAlone(t *testing.T) {
	cfg, hist, _, _ := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"%s","quietPeriod":"0s"}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "photos.db")))
	})
	j, _ := cfg.Find("photos")
	release, held, err := joblock.Take(j.State)
	if err != nil || held {
		t.Fatalf("take the lock: held %v, err %v", held, err)
	}
	defer release()

	r := daemon.New(cfg, hist, nil)
	_, err = r.Run(context.Background(), "photos")
	if !errors.Is(err, daemon.ErrRunningElsewhere) {
		t.Fatalf("got %v, want ErrRunningElsewhere", err)
	}
	if !errors.Is(err, daemon.ErrAlreadyRunning) {
		t.Error("a job running elsewhere does not count as already running")
	}
	runs, err := hist.Recent(context.Background(), "photos", history.ShowAll, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 0 {
		t.Fatalf("a run that never started was recorded: %+v", runs)
	}
}

func TestAJobRunsOnceTheOtherProcessLetsGo(t *testing.T) {
	cfg, hist, _, _ := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"%s","quietPeriod":"0s"}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "photos.db")))
	})
	j, _ := cfg.Find("photos")
	release, _, err := joblock.Take(j.State)
	if err != nil {
		t.Fatal(err)
	}
	r := daemon.New(cfg, hist, nil)
	if _, err := r.Run(context.Background(), "photos"); !errors.Is(err, daemon.ErrRunningElsewhere) {
		t.Fatalf("while held: %v", err)
	}
	release()

	if _, err := r.Run(context.Background(), "photos"); err != nil {
		t.Fatalf("after release: %v", err)
	}
	if again, held, err := joblock.Take(j.State); err != nil || held {
		t.Fatalf("the run kept the lock: held %v, err %v", held, err)
	} else {
		again()
	}
}

func TestARequestForAJobRunningElsewhereIsNotRetriedInALoop(t *testing.T) {
	cfg, hist, _, _ := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"%s","quietPeriod":"0s"}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "photos.db")))
	})
	j, _ := cfg.Find("photos")
	release, _, err := joblock.Take(j.State)
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	var mu sync.Mutex
	lines := 0
	r := daemon.New(cfg, hist, func(string, ...any) {
		mu.Lock()
		lines++
		mu.Unlock()
	})
	if _, err := r.Request("photos", "a test"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if lines > 5 {
		t.Fatalf("the request was tried %d times in 300ms", lines)
	}
}
