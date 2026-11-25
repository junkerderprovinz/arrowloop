package daemon

import (
	"context"
	"sync"
	"time"
)

// pruneEvery is how often the run log is trimmed. It is counted from the last
// trim the log has noted, since a restart or a reload of the configuration
// would otherwise start the count again and a busy machine would never get
// there.
const pruneEvery = 24 * time.Hour

// pruneRetry is how long the schedule waits after a failed trim, which on
// every tick would log the same locked or full disk once a minute.
const pruneRetry = time.Hour

type pruneState struct {
	mu sync.Mutex
	// keep, when set, is used instead of the configuration's historyKeep.
	keep    *time.Duration
	retryAt time.Time
}

// SetHistoryKeep keeps run records for keep instead of what the configuration
// says, through every reload. Zero keeps every record.
func (r *Runner) SetHistoryKeep(keep time.Duration) {
	r.pruning.mu.Lock()
	defer r.pruning.mu.Unlock()
	r.pruning.keep = &keep
}

// pruneIfDue trims the run log when a day has passed since it last was. A
// clock set back since then counts as a day gone by.
func (r *Runner) pruneIfDue(ctx context.Context, now time.Time) {
	if r.hist == nil {
		return
	}
	r.pruning.mu.Lock()
	defer r.pruning.mu.Unlock()
	if now.Before(r.pruning.retryAt) {
		return
	}
	last, ok, err := r.hist.LastPruned(ctx)
	if err == nil && ok && !last.After(now) && now.Sub(last) < pruneEvery {
		return
	}
	_, _ = r.prune(ctx, now)
}

// PruneHistory trims the run log now and says how many runs went. The
// scheduler does this as it starts and once a day after.
func (r *Runner) PruneHistory(ctx context.Context) (int64, error) {
	if r.hist == nil {
		return 0, nil
	}
	r.pruning.mu.Lock()
	defer r.pruning.mu.Unlock()
	return r.prune(ctx, time.Now())
}

func (r *Runner) prune(ctx context.Context, now time.Time) (int64, error) {
	keep, on := r.config().KeepHistoryFor()
	if r.pruning.keep != nil {
		keep, on = *r.pruning.keep, *r.pruning.keep > 0
	}
	if !on {
		return 0, nil
	}
	n, err := r.hist.Prune(ctx, keep, now)
	if n > 0 {
		r.log("trimmed %d run records older than %s from the log", n, keep)
	}
	if err != nil {
		r.pruning.retryAt = now.Add(pruneRetry)
		r.log("could not trim the run log: %v", err)
	}
	return n, err
}
