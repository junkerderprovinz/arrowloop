package daemon

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

func requestRunner(t *testing.T, jobs ...job.Job) *Runner {
	t.Helper()
	root := t.TempDir()
	for i := range jobs {
		jobs[i].Left = filepath.Join(root, jobs[i].Name, "left")
		jobs[i].Right = filepath.Join(root, jobs[i].Name, "right")
		jobs[i].State = filepath.Join(root, jobs[i].Name+".db")
		jobs[i].QuietPeriod = "0s"
		for _, d := range []string{jobs[i].Left, jobs[i].Right} {
			if err := os.MkdirAll(d, 0o755); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.WriteFile(filepath.Join(jobs[i].Left, "a.txt"), []byte("a"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	hist, err := history.Open(context.Background(), filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { hist.Close() })
	return New(&job.Config{Jobs: jobs, ParallelJobs: 1}, hist, nil)
}

func recordedRuns(t *testing.T, r *Runner, name string) int {
	t.Helper()
	runs, err := r.hist.Recent(context.Background(), name, history.ShowAll, 100)
	if err != nil {
		t.Fatal(err)
	}
	return len(runs)
}

// settled waits until name has run at least once and nothing runs or waits
// any more.
func settled(t *testing.T, r *Runner, name string) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		busy := len(r.inflight) + len(r.requested)
		r.mu.Unlock()
		if busy == 0 && recordedRuns(t, r, name) > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the job never ran, or the runner never went quiet")
}

func TestARequestStartsAFreeJob(t *testing.T) {
	r := requestRunner(t, job.Job{Name: "inbox"})
	queued, err := r.Request("inbox", "the downloader")
	if err != nil || queued {
		t.Fatalf("a free job: queued %v, %v; want it started", queued, err)
	}
	settled(t, r, "inbox")
	if n := recordedRuns(t, r, "inbox"); n != 1 {
		t.Fatalf("%d runs recorded, want 1", n)
	}
}

func TestRequestsWhileTheJobRunsMakeOneMoreRunAfterIt(t *testing.T) {
	r := requestRunner(t, job.Job{Name: "inbox"})
	if !r.claim("inbox", func() {}) {
		t.Fatal("the job was already claimed")
	}
	for range 3 {
		queued, err := r.Request("inbox", "the downloader")
		if err != nil || !queued {
			t.Fatalf("a job that runs: queued %v, %v; want the request kept", queued, err)
		}
	}
	if n := recordedRuns(t, r, "inbox"); n != 0 {
		t.Fatalf("%d runs recorded while the job still ran", n)
	}
	r.release("inbox")
	settled(t, r, "inbox")
	if n := recordedRuns(t, r, "inbox"); n != 1 {
		t.Fatalf("%d runs recorded after the job was free, want 1 for all three requests", n)
	}
}

func TestARequestForAnUnknownJobIsRefused(t *testing.T) {
	r := requestRunner(t, job.Job{Name: "inbox"})
	if _, err := r.Request("outbox", "the downloader"); !errors.Is(err, ErrNoSuchJob) {
		t.Fatalf("an unknown job: %v, want ErrNoSuchJob", err)
	}
}

func TestARequestForAPausedJobIsRefused(t *testing.T) {
	r := requestRunner(t, job.Job{Name: "inbox", Disabled: true})
	if _, err := r.Request("inbox", "the downloader"); !errors.Is(err, ErrPaused) {
		t.Fatalf("a paused job: %v, want ErrPaused", err)
	}
	if n := recordedRuns(t, r, "inbox"); n != 0 {
		t.Fatalf("a paused job ran %d times", n)
	}
}
