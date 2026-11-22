package daemon_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/joblock"
)

func TestAWakeUpNamesWhatEachDueJobCameTo(t *testing.T) {
	cfg, hist, _, _ := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[
			{"name":"photos","left":"%s","right":"%s","state":"%s","schedule":"0 3 * * *","quietPeriod":"0s"},
			{"name":"held","left":"%s","right":"%s","state":"%s","schedule":"0 3 * * *","quietPeriod":"0s"},
			{"name":"by hand","left":"%s","right":"%s","state":"%s","quietPeriod":"0s"}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "photos.db")),
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "held.db")),
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "hand.db")))
	})
	j, _ := cfg.Find("held")
	release, _, err := joblock.Take(filepath.Dir(j.State), j.Key())
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	due := daemon.New(cfg, hist, nil).RunDue(context.Background())

	came := map[string]daemon.Outcome{}
	for _, o := range due.Jobs {
		came[o.Job] = o
	}
	if len(due.Jobs) != 2 || len(came) != 2 {
		t.Fatalf("got %+v, want the two scheduled jobs once each", due.Jobs)
	}
	if got := came["photos"]; got.Err != nil || got.Run.Started.IsZero() {
		t.Errorf("photos came to %+v, want a recorded run", got)
	}
	if got := came["held"]; !errors.Is(got.Err, daemon.ErrRunningElsewhere) {
		t.Errorf("held came to %+v, want ErrRunningElsewhere", got)
	}
	if due.Held != 1 || due.Failed != 0 {
		t.Errorf("held %d, failed %d, want 1 and 0", due.Held, due.Failed)
	}
}

// failingDue is a wake-up's runner with one due job whose run fails, and a
// condition that lets the run start and then answers with after.
func failingDue(t *testing.T, after error) *daemon.Runner {
	t.Helper()
	cfg, hist, _, right := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"%s","schedule":"0 3 * * *","quietPeriod":"0s"}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "photos.db")))
	})
	// A file where the folder should be fails the run.
	if err := os.Remove(right); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(right, []byte("in the way"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := daemon.New(cfg, hist, nil)
	asked := 0
	r.SetCondition(func(context.Context, job.Job) error {
		asked++
		if asked == 1 {
			return nil
		}
		return after
	})
	return r
}

// A phone switched to flight mode while a job ran has nothing to tell anyone
// in the morning; the job is still owed and runs once the network is back.
func TestARunThatLostTheNetworkIsNoFailureOfTheWakeUp(t *testing.T) {
	due := failingDue(t, fmt.Errorf("%w", job.ErrNoNetwork)).RunDue(context.Background())

	if due.Failed != 0 || due.Held != 1 || due.Reason != "" {
		t.Errorf("held %d, failed %d, reason %q, want the run counted as held", due.Held, due.Failed, due.Reason)
	}
}

func TestARunThatFailedWithTheNetworkThereIsAFailure(t *testing.T) {
	for name, after := range map[string]error{
		"the network is there":    nil,
		"another condition holds": errors.New("this phone is not charging"),
	} {
		t.Run(name, func(t *testing.T) {
			due := failingDue(t, after).RunDue(context.Background())
			if due.Failed != 1 || due.Reason == "" {
				t.Errorf("failed %d, reason %q, want the failure told", due.Failed, due.Reason)
			}
		})
	}
}
