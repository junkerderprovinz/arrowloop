package daemon

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// ErrOneWay is returned when a conflict is decided on a job that only writes
// one way. Deciding writes to both sides, and such a job has one it must not
// touch.
var ErrOneWay = errors.New("this job only writes one way, so it has no conflicts to decide")

// Conflict is an open conflict with the job it belongs to, by its name and
// its id.
type Conflict struct {
	Job   string
	JobID string
	apply.Open
}

// Unread is a job whose conflicts could not be read, and why.
type Unread struct {
	Job   string
	JobID string
	Err   error
}

// conflictWait bounds reading one job's conflicts, since rclone waits minutes
// on a server that accepts the connection and never answers.
const conflictWait = time.Minute

// conflictDeadline puts the bound on one read. A test swaps it to decide when
// a read runs out of time.
var conflictDeadline = func(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, conflictWait)
}

// Conflicts lists the open conflicts of every job that writes both ways, or of
// the one job named, oldest first, then by job and path. A job whose sides
// cannot be opened right now is reported rather than failing the whole list.
// The jobs are read at once, since each can wait on a remote. A job whose VPN
// is down is reported unread with vpnconn.ErrNotUp unless connect brings its
// tunnel up.
func (r *Runner) Conflicts(ctx context.Context, only string, connect bool) ([]Conflict, []Unread) {
	var jobs []job.Job
	cfg := r.config()
	asked, _ := cfg.Find(only)
	for _, j := range cfg.Jobs {
		if only != "" && j.Key() != asked.Key() {
			continue
		}
		if j.Left == "" || j.Right == "" || plan.ParseDirection(j.Direction) != plan.Both {
			continue
		}
		jobs = append(jobs, j)
	}

	opens := make([][]apply.Open, len(jobs))
	errs := make([]error, len(jobs))
	var wg sync.WaitGroup
	for i, j := range jobs {
		wg.Go(func() {
			ctx, cancel := conflictDeadline(ctx)
			defer cancel()
			opens[i], errs[i] = r.conflictsOf(ctx, j, connect)
			if errs[i] != nil && errors.Is(context.Cause(ctx), context.DeadlineExceeded) {
				errs[i] = fmt.Errorf("no answer within %s: %w", conflictWait, errs[i])
			}
		})
	}
	wg.Wait()

	var out []Conflict
	var unread []Unread
	for i, j := range jobs {
		if errs[i] != nil {
			unread = append(unread, Unread{Job: j.Name, JobID: j.Key(), Err: errs[i]})
			continue
		}
		for _, o := range opens[i] {
			out = append(out, Conflict{Job: j.Name, JobID: j.Key(), Open: o})
		}
	}
	sort.Slice(out, func(a, b int) bool {
		x, y := out[a], out[b]
		if !x.At.Equal(y.At) {
			return x.At.Before(y.At)
		}
		if x.Job != y.Job {
			return x.Job < y.Job
		}
		return x.Plain < y.Plain
	})
	return out, unread
}

func (r *Runner) conflictsOf(ctx context.Context, j job.Job, connect bool) ([]apply.Open, error) {
	opt, err := j.Options()
	if err != nil {
		return nil, err
	}
	through := r.JoinVPN
	if connect {
		through = r.ThroughVPN
	}
	ctx, done, err := through(engine.Configure(ctx, opt), j)
	if err != nil {
		return nil, err
	}
	defer done()
	ends, db, err := r.open(ctx, j)
	if err != nil {
		return nil, err
	}
	defer ends.Close(context.WithoutCancel(ctx))
	defer db.Close()
	return engine.Conflicts(ctx, ends, db, opt)
}

// Decide carries out what somebody chose for a job's open conflicts as a run of
// the job, so it cannot overlap another run and lands in the history.
func (r *Runner) Decide(ctx context.Context, name string, decisions []apply.Decision) (history.Run, error) {
	if j, ok := r.config().Find(name); ok && plan.ParseDirection(j.Direction) != plan.Both {
		return history.Run{}, fmt.Errorf("%w: %s", ErrOneWay, j.Name)
	}
	return r.runAs(ctx, name, false, func(ctx context.Context, j job.Job, live *history.Live) (apply.Result, *plan.Plan, error) {
		res, err := r.decide(ctx, j, decisions, live)
		return res, nil, err
	})
}

func (r *Runner) decide(ctx context.Context, j job.Job, decisions []apply.Decision, live *history.Live) (apply.Result, error) {
	opt, err := j.Options()
	if err != nil {
		return apply.Result{}, err
	}
	ctx = engine.Configure(ctx, opt)
	ctx = apply.WithTrash(ctx, !j.NoTrash)
	ends, db, err := r.open(ctx, j)
	if err != nil {
		return apply.Result{}, err
	}
	defer ends.Close(context.WithoutCancel(ctx))
	defer db.Close()
	r.log("%s: deciding %d conflicts as chosen", j.Name, len(decisions))
	return engine.Decide(ctx, ends, db, decisions, opt, progressFor{runner: r, job: j, live: live})
}
