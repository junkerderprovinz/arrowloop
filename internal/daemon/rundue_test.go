package daemon_test

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
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
	release, _, err := joblock.Take(j.State)
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
