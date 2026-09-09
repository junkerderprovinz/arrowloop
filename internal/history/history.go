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

// Entry is one thing a run did to one path.
//
// The counts on a Run answer "how much", and that turned out not to be the
// question. A run that reports one error says nothing about WHICH file, and a
// run that reports two conflicts says nothing about what it decided, which
// matters most for a scheduled run nobody watched: the default keeps both
// versions, so the decision was made on somebody's behalf and they were never
// told. jdp: "was passiert bei fehlern und konflikten? Wo werden die angezeigt
// und wo kann man konflikte loesen?"
type Entry struct {
	Kind string // copy, move, trash, conflict, mkdir, rmdir, skip, error
	Side string // left, right, or empty where the action has no side
	Path string
	// Note carries what a number cannot: the error's own words, or which way a
	// conflict was resolved. Empty for the ordinary case.
	Note string
	// Size is how big the file was, where the action had one. Zero for a
	// folder, a skip and an error, which is "not applicable" rather than "an
	// empty file". A per-file log without it says what moved and not what it
	// cost.
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

// migrations are the ALTERs an existing database needs, which CREATE TABLE IF
// NOT EXISTS cannot give it: that statement is a no-op on a table that already
// exists, so a column added to the schema above reaches new installs only.
//
// Each has to be harmless when it has already been applied, because there is no
// version number here to consult - the error from adding a duplicate column is
// the check. Kept as a list rather than as one string so that one failing does
// not stop the rest.
var migrations = []string{
	`ALTER TABLE entries ADD COLUMN size INTEGER NOT NULL DEFAULT 0`,
}

// Open opens or creates the history database.
func Open(ctx context.Context, path string) (*DB, error) {
	// The run log defaults to sitting beside the configuration, whose folder
	// always exists, but the path is configurable and a nested one would fail
	// the same way a job's state database used to.
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
		// Errors ignored on purpose: the expected one is "duplicate column",
		// which means the migration has already run. A real failure shows up on
		// the next read, and refusing to open the log over it would take the
		// whole program down for a column nothing has needed yet.
		_, _ = handle.ExecContext(ctx, m)
	}
	return &DB{sql: handle}, nil
}

// Close releases the handle.
func (d *DB) Close() error { return d.sql.Close() }

// Record stores one finished run and everything it did, together.
//
// One transaction, and that is the point rather than a performance note. A run
// row without its entries reads as a run that touched nothing, which is exactly
// the picture somebody would be given about the run they most want to look
// into. Written apart, a crash between the two writes produces that picture
// permanently.
//
// Said plainly because it would otherwise be assumed: THE ATOMICITY ITSELF IS
// NOT COVERED BY A TEST. Reaching the failure it guards against means dying
// between two writes, and the only ways to stage that from a test are a hook
// that exists for the test alone or a data value crafted to break the second
// insert - and a test that builds a state the program cannot reach is a test
// that proves something about the test. What the tests beside this DO cover is
// everything observable: the entries arrive, in order, tied to their own run,
// and they are pruned with it. The transaction is here because it is right,
// not because something checks it.
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

// Entries returns what one run did, in the order it did it.
//
// Order matters here in a way it does not for the counts: reading down the list
// of a failed run is how somebody works out what it got through before it
// stopped.
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

// Touch is one thing that happened to one file, with the run it belonged to.
//
// The plain Entry says what was done and to which path, which is enough while
// you are reading ONE run. Across runs it is not: the same file copied on
// Tuesday and again on Friday is two identical lines, and neither says when.
type Touch struct {
	Entry
	Run  int64
	When time.Time
}

// Recent touches for one job, newest first, across all of its runs.
//
// This is a different question from Recent(), and the difference is what a job
// card's activity fold is for. "Which runs happened" is the run log's question
// and the history tab answers it. "What has this job actually DONE to my files"
// is the one somebody has while looking at the job, and until now the fold
// answered the first one - the same list, in a smaller box. jdp: "Im
// aktivitaetslog moechte ich nicht die laeufe sehen sondern ein log ueber die
// einzelnen dateien, welche kopiert, welche geloescht wurden etc."
//
// Joined rather than fetched run by run: a job that ran two hundred times to
// produce four interesting lines would otherwise cost two hundred queries to
// find them.
func (d *DB) Touches(ctx context.Context, job string, limit int) ([]Touch, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := d.sql.QueryContext(ctx,
		`SELECT e.run, r.started, e.kind, e.side, e.path, e.note, e.size
		 FROM entries e JOIN runs r ON r.id = e.run
		 WHERE r.job = ?
		 ORDER BY r.started DESC, e.seq DESC
		 LIMIT ?`, job, limit)
	if err != nil {
		return nil, fmt.Errorf("read what %q did: %w", job, err)
	}
	defer rows.Close()

	var out []Touch
	for rows.Next() {
		var t Touch
		var started int64
		if err := rows.Scan(&t.Run, &started, &t.Kind, &t.Side, &t.Path, &t.Note, &t.Size); err != nil {
			return nil, fmt.Errorf("scan touch: %w", err)
		}
		t.When = time.Unix(0, started)
		out = append(out, t)
	}
	return out, rows.Err()
}

// Show says which runs a listing is asking for.
//
// It exists because the run log's honesty is also its problem. Every run is
// written down, including the ones that found nothing to do, and that is what
// makes "has this been working" answerable at all. But a job watching a folder
// runs on every change and on its schedule besides, so it writes an entry a
// minute, and fifty entries is then fifty minutes: a job that runs once a day is
// not further down the page, it is not on the page. jdp: "echtzeit auftraege
// ausblenden weil die andauernd laufen und ein eintrag machen. wenn ein auftrag
// zb nur einemal am tag laeuft geht der unter."
//
// Which is why this is a QUERY and not a filter the browser applies to what it
// was sent. Hiding the quiet runs after the fact hides them out of the fifty
// already fetched and leaves the daily job just as missing.
type Show string

const (
	// ShowAll is every run, which is what the log is for.
	ShowAll Show = ""
	// ShowChanged is the runs that did something: copied, moved, trashed,
	// resolved a conflict, or made or removed a folder. A run that failed did
	// not do those things and is included anyway, because a failure is the
	// most interesting thing a run can report.
	ShowChanged Show = "changed"
	// ShowFailed is the runs that ended badly, and nothing else.
	ShowFailed Show = "failed"
)

// where is the SQL this filter means, or the empty string for all of them.
//
// Written next to the constants rather than at the call site so the two cannot
// drift: `changed` here has to keep meaning what Run.Changed() means, and a
// copy of this condition somewhere else is how those two stop agreeing.
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
	cut := now.Add(-keep).UnixNano()
	// The entries go with their run, and they go FIRST. SQLite does not enforce
	// a foreign key unless asked to, so nothing here would have complained
	// about entries whose run no longer exists - they would simply have sat in
	// the file for ever, invisible and growing, which is the exact failure
	// pruning exists to prevent.
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
