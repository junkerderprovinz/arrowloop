// Package history keeps a record of what every run did.
//
// A scheduled job that nobody watches is only trustworthy if it can be asked
// afterwards. The failure this guards against is not a crash, which is loud,
// but a job that has been quietly doing nothing for three weeks because a path
// changed: without a history there is nothing to notice, and the backup that
// was believed to exist does not.
package history

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver, no cgo, so cross-compiling stays trivial
)

// Run is one execution of one job.
type Run struct {
	ID          int64
	Job         string
	Started     time.Time
	Finished    time.Time
	Copied      int
	Moved       int
	Trashed     int
	Conflicts   int
	DirsMade    int
	DirsRemoved int
	Unchanged   int
	Skipped     int
	Err         string
}

// Failed reports whether the run ended badly.
func (r Run) Failed() bool { return r.Err != "" }

// Changed reports whether the run actually moved anything, which is what makes
// it worth mentioning.
func (r Run) Changed() bool {
	return r.Copied+r.Moved+r.Trashed+r.Conflicts+r.DirsMade+r.DirsRemoved > 0
}

// DB is the run log.
type DB struct{ sql *sql.DB }

const schema = `
CREATE TABLE IF NOT EXISTS runs (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	job          TEXT    NOT NULL,
	started      INTEGER NOT NULL,
	finished     INTEGER NOT NULL,
	copied       INTEGER NOT NULL,
	moved        INTEGER NOT NULL,
	trashed      INTEGER NOT NULL,
	conflicts    INTEGER NOT NULL,
	dirs_made    INTEGER NOT NULL,
	dirs_removed INTEGER NOT NULL,
	unchanged    INTEGER NOT NULL,
	skipped      INTEGER NOT NULL,
	err          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_job_started ON runs (job, started DESC);
`

// Open opens or creates the history database.
func Open(ctx context.Context, path string) (*DB, error) {
	handle, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("open history: %w", err)
	}
	if _, err := handle.ExecContext(ctx, schema); err != nil {
		handle.Close()
		return nil, fmt.Errorf("create history schema: %w", err)
	}
	return &DB{sql: handle}, nil
}

// Close releases the handle.
func (d *DB) Close() error { return d.sql.Close() }

// Record stores one finished run.
func (d *DB) Record(ctx context.Context, r Run) error {
	_, err := d.sql.ExecContext(ctx,
		`INSERT INTO runs (job, started, finished, copied, moved, trashed, conflicts, dirs_made, dirs_removed, unchanged, skipped, err)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.Job, r.Started.UnixNano(), r.Finished.UnixNano(),
		r.Copied, r.Moved, r.Trashed, r.Conflicts, r.DirsMade, r.DirsRemoved, r.Unchanged, r.Skipped, r.Err)
	if err != nil {
		return fmt.Errorf("record run for %q: %w", r.Job, err)
	}
	return nil
}

// Recent returns the newest runs first. An empty job name means every job.
func (d *DB) Recent(ctx context.Context, job string, limit int) ([]Run, error) {
	if limit <= 0 {
		limit = 20
	}
	query := `SELECT id, job, started, finished, copied, moved, trashed, conflicts, dirs_made, dirs_removed, unchanged, skipped, err
	          FROM runs`
	args := []any{}
	if job != "" {
		query += ` WHERE job = ?`
		args = append(args, job)
	}
	query += ` ORDER BY started DESC LIMIT ?`
	args = append(args, limit)

	rows, err := d.sql.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("read history: %w", err)
	}
	defer rows.Close()

	var out []Run
	for rows.Next() {
		var r Run
		var started, finished int64
		if err := rows.Scan(&r.ID, &r.Job, &started, &finished, &r.Copied, &r.Moved, &r.Trashed,
			&r.Conflicts, &r.DirsMade, &r.DirsRemoved, &r.Unchanged, &r.Skipped, &r.Err); err != nil {
			return nil, fmt.Errorf("scan run: %w", err)
		}
		r.Started = time.Unix(0, started)
		r.Finished = time.Unix(0, finished)
		out = append(out, r)
	}
	return out, rows.Err()
}

// LastSuccess returns when a job last finished without an error, and whether it
// ever has.
//
// This is the question a person actually asks, and the one a list of runs
// answers badly: "when did this last work" is not the same as "when did this
// last run", and a job failing every fifteen minutes for a week looks busy in a
// log while being of no use whatsoever.
func (d *DB) LastSuccess(ctx context.Context, job string) (time.Time, bool, error) {
	var finished int64
	err := d.sql.QueryRowContext(ctx,
		`SELECT finished FROM runs WHERE job = ? AND err = '' ORDER BY started DESC LIMIT 1`, job).Scan(&finished)
	if err == sql.ErrNoRows {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, fmt.Errorf("last success for %q: %w", job, err)
	}
	return time.Unix(0, finished), true, nil
}

// Prune drops runs older than the given age, so the log does not grow without
// bound on a machine nobody looks at.
func (d *DB) Prune(ctx context.Context, keep time.Duration, now time.Time) (int64, error) {
	if keep <= 0 {
		return 0, nil
	}
	res, err := d.sql.ExecContext(ctx, `DELETE FROM runs WHERE started < ?`, now.Add(-keep).UnixNano())
	if err != nil {
		return 0, fmt.Errorf("prune history: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}
