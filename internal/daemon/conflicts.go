package daemon

import (
	"context"
	"errors"
	"fmt"
	"sort"

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

// Conflict is an open conflict with the job it belongs to.
type Conflict struct {
	Job string
	apply.Open
}

// Unread is a job whose conflicts could not be read, and why.
type Unread struct {
	Job string
	Err error
}

// Conflicts lists the open conflicts of every job that writes both ways, or of
// the one job named, oldest first, then by job and path. A job whose sides
// cannot be opened right now is reported rather than failing the whole list.
func (r *Runner) Conflicts(ctx context.Context, only string) ([]Conflict, []Unread) {
	var out []Conflict
	var unread []Unread
	for _, j := range r.config().Jobs {
		if only != "" && j.Name != only {
			continue
		}
		if j.Left == "" || j.Right == "" || plan.ParseDirection(j.Direction) != plan.Both {
			continue
		}
		open, err := r.conflictsOf(ctx, j)
		if err != nil {
			unread = append(unread, Unread{Job: j.Name, Err: err})
			continue
		}
		for _, o := range open {
			out = append(out, Conflict{Job: j.Name, Open: o})
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

func (r *Runner) conflictsOf(ctx context.Context, j job.Job) ([]apply.Open, error) {
	opt, err := j.Options()
	if err != nil {
		return nil, err
	}
	ctx = engine.Configure(ctx, opt)
	ends, db, err := r.open(ctx, j)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	return engine.Conflicts(ctx, ends, db, opt)
}

// Decide carries out what somebody chose for a job's open conflicts as a run of
// the job, so it cannot overlap another run and lands in the history.
func (r *Runner) Decide(ctx context.Context, name string, decisions []apply.Decision) (history.Run, error) {
	if j, ok := r.config().Find(name); ok && plan.ParseDirection(j.Direction) != plan.Both {
		return history.Run{}, fmt.Errorf("%w: %s", ErrOneWay, name)
	}
	return r.runAs(ctx, name, func(ctx context.Context, j job.Job, live *history.Live) (apply.Result, *plan.Plan, error) {
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
	defer db.Close()
	r.log("%s: deciding %d conflicts as chosen", j.Name, len(decisions))
	return engine.Decide(ctx, ends, db, decisions, opt, progressFor{runner: r, job: j.Name, live: live})
}
