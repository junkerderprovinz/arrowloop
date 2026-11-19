package daemon_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/joblock"
)

func TestAJobAnotherProcessRunsIsLeftAlone(t *testing.T) {
	cfg, hist, _, _ := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"%s","quietPeriod":"0s"}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "photos.db")))
	})
	j, _ := cfg.Find("photos")
	release, held, err := joblock.Take(filepath.Dir(j.State), j.Key())
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
	release, _, err := joblock.Take(filepath.Dir(j.State), j.Key())
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
	if again, held, err := joblock.Take(filepath.Dir(j.State), j.Key()); err != nil || held {
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
	release, _, err := joblock.Take(filepath.Dir(j.State), j.Key())
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

func TestARenameDoesNotLetASecondProcessRunTheJob(t *testing.T) {
	dir := t.TempDir()
	left, right := filepath.Join(dir, "left"), filepath.Join(dir, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	pause := "sleep 5"
	if runtime.GOOS == "windows" {
		pause = "ping -n 6 127.0.0.1 > nul"
	}
	path := filepath.Join(dir, "arrowloop.json")
	// The editor moves a generated state path along with the name.
	load := func(name string) *job.Config {
		t.Helper()
		body := fmt.Sprintf(`{"jobs":[{"id":"a1b2c3d4e5f6","name":"%s","left":"%s","right":"%s","state":"state/%s.db","before":"%s","quietPeriod":"0s"}]}`,
			name, jsonPath(left), jsonPath(right), name, pause)
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		cfg, err := job.Load(path)
		if err != nil {
			t.Fatal(err)
		}
		return cfg
	}
	before := load("photos")
	after := load("pictures")
	hist, err := history.Open(context.Background(), before.History)
	if err != nil {
		t.Fatal(err)
	}
	defer hist.Close()

	first := daemon.New(before, hist, nil)
	events, unsubscribe := first.Subscribe()
	defer unsubscribe()
	done := make(chan error, 1)
	go func() {
		_, err := first.Run(context.Background(), "photos")
		done <- err
	}()
	waitForStart(t, events)

	_, err = daemon.New(after, hist, nil).Run(context.Background(), "pictures")
	if !errors.Is(err, daemon.ErrRunningElsewhere) {
		t.Errorf("the renamed job ran beside the old name's run: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("the first run: %v", err)
	}
}

func waitForStart(t *testing.T, events <-chan daemon.Event) {
	t.Helper()
	timeout := time.After(10 * time.Second)
	for {
		select {
		case ev := <-events:
			if ev.Phase == "started" {
				return
			}
		case <-timeout:
			t.Fatal("the run never started")
		}
	}
}
