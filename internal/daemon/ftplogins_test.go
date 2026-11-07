package daemon_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	_ "github.com/rclone/rclone/backend/ftp"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/failure"
	"github.com/junkerderprovinz/arrowloop/internal/ftptest"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// phoneJob is a job from the FTP server app on a phone, which lets four
// logins in at once, to a folder on this machine, with ten transfers as the
// settings may well ask for.
func phoneJob(t *testing.T) (*daemon.Runner, *ftptest.Server) {
	t.Helper()
	return phoneJobLetting(t, 4, "", t.Logf)
}

// phoneJobLetting is phoneJob against a server that lets most logins in at
// once, reached with the extra settings given, such as ",concurrency=4".
func phoneJobLetting(t *testing.T, most int, settings string, log func(string, ...any)) (*daemon.Runner, *ftptest.Server) {
	t.Helper()
	root := t.TempDir()
	phone := filepath.Join(root, "phone")
	for i := range 12 {
		dir := filepath.Join(phone, fmt.Sprintf("album%02d", i))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(filepath.Join(dir, "photo.jpg"), []byte("jpeg"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	server := ftptest.Start(t, phone, most)

	hist, err := history.Open(context.Background(), filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	cfg := &job.Config{
		Jobs: []job.Job{{
			Name: "phone", Left: strings.TrimSuffix(server.Remote(t), ":") + settings + ":", Right: filepath.Join(root, "pc"),
			State: filepath.Join(root, "phone.db"), QuietPeriod: "0s", Transfers: 10,
		}},
		ParallelJobs: 1,
	}
	return daemon.New(cfg, hist, log), server
}

func TestAPreviewStaysWithinTheLoginsAnFTPServerTakes(t *testing.T) {
	r, server := phoneJob(t)

	p, err := r.Preview(context.Background(), "phone")
	if err != nil {
		t.Fatalf("the preview failed: %v", err)
	}
	if len(p.Actions) != 12 {
		t.Errorf("the preview proposes %d changes, want the 12 photos", len(p.Actions))
	}
	if server.Refused() > 0 {
		t.Errorf("the server turned %d logins away", server.Refused())
	}
}

// A run right after the preview would otherwise find the preview's logins
// still open and be refused its own.
func TestAPreviewLogsOutOfTheFTPServer(t *testing.T) {
	r, server := phoneJob(t)

	if _, err := r.Preview(context.Background(), "phone"); err != nil {
		t.Fatalf("the preview failed: %v", err)
	}
	waitFor(t, func() bool { return server.LoggedIn() == 0 }, "the preview left its logins open")
}

func TestAPreviewRightAfterAnotherGetsItsLogins(t *testing.T) {
	r, server := phoneJob(t)

	if _, err := r.Preview(context.Background(), "phone"); err != nil {
		t.Fatalf("the preview failed: %v", err)
	}
	if _, err := r.Preview(context.Background(), "phone"); err != nil {
		t.Fatalf("the second preview failed: %v", err)
	}
	if server.Refused() > 0 {
		t.Errorf("the server turned %d logins away", server.Refused())
	}
}

// A server that takes fewer logins than ArrowLoop opens is met with fewer,
// without anybody lowering the target's concurrency.
func TestAPreviewSettlesForTheLoginsAnFTPServerTakes(t *testing.T) {
	for _, most := range []int{2, 1} {
		t.Run(fmt.Sprintf("%d logins", most), func(t *testing.T) {
			r, server := phoneJobLetting(t, most, "", t.Logf)

			p, err := r.Preview(context.Background(), "phone")
			if err != nil {
				t.Fatalf("the preview failed: %v", err)
			}
			if len(p.Actions) != 12 {
				t.Errorf("the preview proposes %d changes, want the 12 photos", len(p.Actions))
			}
			if server.Peak() > most {
				t.Errorf("%d logins at once, the server takes %d", server.Peak(), most)
			}
		})
	}
}

func TestARunSettlesForTheLoginsAnFTPServerTakes(t *testing.T) {
	for _, most := range []int{2, 1} {
		t.Run(fmt.Sprintf("%d logins", most), func(t *testing.T) {
			r, _ := phoneJobLetting(t, most, "", t.Logf)

			rec, err := r.Run(context.Background(), "phone")
			if err != nil {
				t.Fatalf("the run failed: %v", err)
			}
			if rec.Copied != 12 || rec.Skipped != 0 {
				t.Errorf("the run copied %d and skipped %d, want the 12 photos copied", rec.Copied, rec.Skipped)
			}
		})
	}
}

// Finding the number again would cost a refused login every time.
func TestTheLoginsAnFTPServerTakesAreRemembered(t *testing.T) {
	var mu sync.Mutex
	var said []string
	log := func(format string, args ...any) {
		mu.Lock()
		defer mu.Unlock()
		said = append(said, fmt.Sprintf(format, args...))
	}
	r, server := phoneJobLetting(t, 2, "", log)

	if _, err := r.Preview(context.Background(), "phone"); err != nil {
		t.Fatalf("the preview failed: %v", err)
	}
	refused := server.Refused()
	if refused == 0 {
		t.Fatal("the server never turned a login away, so nothing was learned")
	}
	mu.Lock()
	noted := strings.Join(said, "\n")
	mu.Unlock()
	if !strings.Contains(noted, "2 connections") {
		t.Errorf("the log does not say the job went on with 2 connections:\n%s", noted)
	}

	if _, err := r.Run(context.Background(), "phone"); err != nil {
		t.Fatalf("the run failed: %v", err)
	}
	if server.Refused() != refused {
		t.Errorf("the run was turned away %d more times", server.Refused()-refused)
	}
}

func TestATargetsOwnConcurrencyIsNotLowered(t *testing.T) {
	r, server := phoneJobLetting(t, 2, ",concurrency=4", t.Logf)

	_, err := r.Preview(context.Background(), "phone")
	if f := failureOf(err); f == nil || f.Code != failure.TooManyLogins {
		t.Fatalf("the preview ended with %v, want the server out of logins", err)
	}
	if server.Peak() != 2 {
		t.Errorf("at most %d logins at once, want the 2 the server takes", server.Peak())
	}
}

func failureOf(err error) *failure.Failure {
	if err == nil {
		return nil
	}
	return failure.Of(err.Error())
}
