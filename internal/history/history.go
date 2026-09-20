// Package history keeps a record of what every run did, so a job that has
// quietly done nothing for weeks can be noticed.
package history

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strings"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver, no cgo, so cross-compiling stays trivial

	"github.com/junkerderprovinz/arrowloop/internal/dbfile"
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

// Entry is one thing a run did to one path. The counts on a Run do not say
// which file failed or how a conflict was decided; entries do.
type Entry struct {
	Kind string // copy, move, trash, conflict, mkdir, rmdir, skip, error
	Side string // left, right, or empty where the action has no side
	Path string
	// Note is the error's own words, or which way a conflict was resolved.
	// Empty for the ordinary case.
	Note string
	// Size is how big the file was. Zero for a folder, a skip and an error,
	// where it does not apply.
	Size int64
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

CREATE TABLE IF NOT EXISTS entries (
	run  INTEGER NOT NULL,
	seq  INTEGER NOT NULL,
	kind TEXT    NOT NULL,
	side TEXT    NOT NULL,
	path TEXT    NOT NULL,
	note TEXT    NOT NULL,
	size INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (run, seq)
);
`

// migrations are the ALTERs an existing database needs, since the schema
// leaves a table that already exists alone. There is no version number, so
// each must be harmless when it has already run; they are separate so that one
// failing does not stop the rest.
var migrations = []string{
	`ALTER TABLE entries ADD COLUMN size INTEGER NOT NULL DEFAULT 0`,
}

// Open opens or creates the history database.
func Open(ctx context.Context, path string) (*DB, error) {
	// The path is configurable, and a nested one may not exist yet.
	if err := dbfile.EnsureDir(path); err != nil {
		return nil, err
	}
	handle, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("open history: %w", err)
	}
	if _, err := handle.ExecContext(ctx, schema); err != nil {
		handle.Close()
		return nil, fmt.Errorf("create history schema: %w", err)
	}
	for _, m := range migrations {
		// The expected error is "duplicate column", meaning the migration has
		// already run. A real failure shows up on the next read.
		_, _ = handle.ExecContext(ctx, m)
	}
	return &DB{sql: handle}, nil
}

// Close releases the handle.
func (d *DB) Close() error { return d.sql.Close() }

// Record stores one finished run and everything it did in one transaction,
// because a run row without its entries would read as a run that touched
// nothing. The atomicity itself has no test, since staging a crash between the
// two writes would need a hook that exists only for the test.
func (d *DB) Record(ctx context.Context, r Run, entries []Entry) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("record run for %q: %w", r.Job, err)
	}
	defer tx.Rollback() //nolint:errcheck // a committed transaction rolls back to nothing

	res, err := tx.ExecContext(ctx,
		`INSERT INTO runs (job, started, finished, copied, moved, trashed, conflicts, dirs_made, dirs_removed, unchanged, skipped, err)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.Job, r.Started.UnixNano(), r.Finished.UnixNano(),
		r.Copied, r.Moved, r.Trashed, r.Conflicts, r.DirsMade, r.DirsRemoved, r.Unchanged, r.Skipped, r.Err)
	if err != nil {
		return fmt.Errorf("record run for %q: %w", r.Job, err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("record run for %q: %w", r.Job, err)
	}

	for i, e := range entries {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO entries (run, seq, kind, side, path, note, size) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, i, e.Kind, e.Side, e.Path, e.Note, e.Size); err != nil {
			return fmt.Errorf("record entry %d for %q: %w", i, r.Job, err)
		}
	}
	return tx.Commit()
}

// Entries returns what one run did, in the order it did it, so a failed run
// shows how far it got.
func (d *DB) Entries(ctx context.Context, run int64) ([]Entry, error) {
	rows, err := d.sql.QueryContext(ctx,
		`SELECT kind, side, path, note, size FROM entries WHERE run = ? ORDER BY seq`, run)
	if err != nil {
		return nil, fmt.Errorf("read entries for run %d: %w", run, err)
	}
	defer rows.Close()

	var out []Entry
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.Kind, &e.Side, &e.Path, &e.Note, &e.Size); err != nil {
			return nil, fmt.Errorf("scan entry: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Touch is one thing that happened to one file, with the run, job and time it
// belongs to, so lines from different runs can be told apart.
type Touch struct {
	Entry
	Run  int64
	Job  string
	When time.Time
}

// Touches returns what one job did to files, newest first, across all of its
// runs.
func (d *DB) Touches(ctx context.Context, job string, limit int) ([]Touch, error) {
	return d.TouchesLike(ctx, job, "", limit)
}

// TouchesLike is Touches, narrowed to the paths that contain a piece of text.
func (d *DB) TouchesLike(ctx context.Context, job, contains string, limit int) ([]Touch, error) {
	return d.Log(ctx, Filter{Job: job, Contains: contains, Limit: limit})
}

// Filter narrows the per-file log. An empty field does not narrow, so the
// whole log is Filter{}, and a zero Limit takes the default.
type Filter struct {
	// Job narrows to one job. Empty means every job.
	Job string
	// Contains is a fragment of a path, matched case-insensitively.
	Contains string
	// Kinds narrows to kinds of entry such as copy, trash or error. Empty
	// means all of them.
	Kinds []string
	Limit int
}

// Log is every file this engine has touched, newest first. It narrows in the
// database, since the log runs to tens of thousands of rows and filtering the
// newest page would not find which run touched an older file.
func (d *DB) Log(ctx context.Context, f Filter) ([]Touch, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	where, args := "1 = 1", []any{}
	if f.Job != "" {
		where += " AND r.job = ?"
		args = append(args, f.Job)
	}
	if len(f.Kinds) > 0 {
		where += " AND e.kind IN (" + strings.TrimSuffix(strings.Repeat("?,", len(f.Kinds)), ",") + ")"
		for _, k := range f.Kinds {
			args = append(args, k)
		}
	}
	if f.Contains != "" {
		// LIKE's wildcards are escaped, so an underscore in a path matches
		// only an underscore.
		esc := strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(f.Contains)
		where += ` AND e.path LIKE ? ESCAPE '\'`
		args = append(args, "%"+esc+"%")
	}
	args = append(args, limit)
	rows, err := d.sql.QueryContext(ctx,
		`SELECT e.run, r.job, r.started, e.kind, e.side, e.path, e.note, e.size
		 FROM entries e JOIN runs r ON r.id = e.run
		 WHERE `+where+`
		 ORDER BY r.started DESC, e.seq DESC
		 LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("read the file log: %w", err)
	}
	defer rows.Close()

	var out []Touch
	for rows.Next() {
		var t Touch
		var started int64
		if err := rows.Scan(&t.Run, &t.Job, &started, &t.Kind, &t.Side, &t.Path, &t.Note, &t.Size); err != nil {
			return nil, fmt.Errorf("scan touch: %w", err)
		}
		t.When = time.Unix(0, started)
		out = append(out, t)
	}
	return out, rows.Err()
}

// Show says which runs a listing is asking for. A watching job writes a run
// every few minutes and pushes a daily job off the page, so the quiet runs are
// left out by the query rather than hidden from what was already fetched.
type Show string

const (
	// ShowAll is every run, which is what the log is for.
	ShowAll Show = ""
	// ShowChanged is the runs that copied, moved, trashed, resolved a
	// conflict, or made or removed a folder, plus every failed run.
	ShowChanged Show = "changed"
	// ShowFailed is the runs that ended badly.
	ShowFailed Show = "failed"
)

// where is the SQL condition for this filter, or "" for all runs. The changed
// condition has to match Run.Changed.
func (s Show) where() string {
	switch s {
	case ShowChanged:
		return `(copied + moved + trashed + conflicts + dirs_made + dirs_removed > 0 OR err <> '')`
	case ShowFailed:
		return `err <> ''`
	default:
		return ``
	}
}

// Recent returns the newest runs first. An empty job name means every job, and
// ShowAll means every run.
func (d *DB) Recent(ctx context.Context, job string, show Show, limit int) ([]Run, error) {
	return d.Between(ctx, job, show, time.Time{}, time.Time{}, limit)
}

// Between is Recent, narrowed to a stretch of time. A zero end means no bound
// that way.
func (d *DB) Between(ctx context.Context, job string, show Show, since, until time.Time, limit int) ([]Run, error) {
	if limit <= 0 {
		limit = 20
	}
	query := `SELECT id, job, started, finished, copied, moved, trashed, conflicts, dirs_made, dirs_removed, unchanged, skipped, err
	          FROM runs`
	args := []any{}
	var conds []string
	if job != "" {
		conds = append(conds, `job = ?`)
		args = append(args, job)
	}
	if w := show.where(); w != "" {
		conds = append(conds, w)
	}
	if !since.IsZero() {
		conds = append(conds, `started >= ?`)
		args = append(args, since.UnixNano())
	}
	if !until.IsZero() {
		conds = append(conds, `started <= ?`)
		args = append(args, until.UnixNano())
	}
	if len(conds) > 0 {
		query += ` WHERE ` + strings.Join(conds, ` AND `)
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

// FailuresSince counts the runs of one job that ended badly after a given
// moment, and reports when the last of them finished. Passed the job's last
// success, it counts the failures in a row; the zero time counts them all.
func (d *DB) FailuresSince(ctx context.Context, job string, since time.Time) (int, time.Time, error) {
	// UnixNano is undefined for the zero time.
	cut := int64(math.MinInt64)
	if !since.IsZero() {
		cut = since.UnixNano()
	}
	var count int
	var last sql.NullInt64
	err := d.sql.QueryRowContext(ctx,
		`SELECT COUNT(*), MAX(finished) FROM runs WHERE job = ? AND err != '' AND started > ?`,
		job, cut).Scan(&count, &last)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("failures for %q: %w", job, err)
	}
	if !last.Valid {
		return count, time.Time{}, nil
	}
	return count, time.Unix(0, last.Int64), nil
}

// Prune drops runs older than the given age, so the log does not grow without
// bound on a machine nobody looks at.
func (d *DB) Prune(ctx context.Context, keep time.Duration, now time.Time) (int64, error) {
	if keep <= 0 {
		return 0, nil
	}
	cut := now.Add(-keep).UnixNano()
	// Entries go first, while their runs can still be found. SQLite does not
	// enforce the foreign key, so orphaned entries would stay for ever.
	if _, err := d.sql.ExecContext(ctx,
		`DELETE FROM entries WHERE run IN (SELECT id FROM runs WHERE started < ?)`, cut); err != nil {
		return 0, fmt.Errorf("prune history entries: %w", err)
	}
	res, err := d.sql.ExecContext(ctx, `DELETE FROM runs WHERE started < ?`, cut)
	if err != nil {
		return 0, fmt.Errorf("prune history: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}
