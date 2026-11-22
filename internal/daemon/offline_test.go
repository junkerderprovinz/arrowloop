package daemon

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// A phone that loses its network halfway through a run leaves files for
// later. The run is no failure, and the job is owed again at the next wake-up
// that has a network rather than at its next scheduled turn.
func TestARunTheNetworkLeftIsOwedAgainOnceTheNetworkIsBack(t *testing.T) {
	r := runnerWithALink(t)
	r.config().Jobs[0].Schedule = "0 3 * * *"
	online := true
	asked := 0
	r.SetCondition(func(context.Context, job.Job) error {
		asked++
		if asked > 1 && !online {
			return job.ErrNoNetwork
		}
		return nil
	})
	online = false

	due := r.RunDue(context.Background())
	if len(due.Jobs) != 1 || due.Jobs[0].Run.Skipped != 1 || due.Failed != 0 || due.Held != 1 {
		t.Fatalf("wake-up %+v, want the run held with its file left for later", due)
	}

	online = true
	if got := r.Due(context.Background(), time.Now()); !slices.Equal(got, []string{r.config().Jobs[0].Key()}) {
		t.Errorf("due %v once the network is back, want the job", got)
	}
}

func TestARunThatLeftAFileWithTheNetworkThereWaitsForItsTurn(t *testing.T) {
	r := runnerWithALink(t)
	r.config().Jobs[0].Schedule = "0 3 * * *"
	r.SetCondition(func(context.Context, job.Job) error { return nil })

	if due := r.RunDue(context.Background()); due.Held != 0 {
		t.Fatalf("wake-up %+v, want the run counted as one that ran", due)
	}
	if got := r.Due(context.Background(), time.Now()); len(got) != 0 {
		t.Errorf("due %v right after a run, want nothing until 3:00", got)
	}
}
