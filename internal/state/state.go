// Package state holds the last agreed state of a sync job.
//
// Without a per-file record of what both sides looked like when they last
// agreed, a file present only on the left could have been created there or
// deleted on the right, and the two call for opposite actions.
package state

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver, no cgo, so cross-compiling stays trivial

	"github.com/junkerderprovinz/arrowloop/internal/dbfile"
)

// Entry is one file as it stood on both sides the last time they agreed.
//
// An empty hash means the backend could not produce one, not an empty file.
// Path is the matching key; LeftPath and RightPath are each side's own name for
// the file, which can differ in Unicode normalisation.
type Entry struct {
	Path      string
	LeftPath  string
	RightPath string
	LeftSize  int64
	LeftMod   time.Time
	LeftHash  string
	RightSize int64
	RightMod  time.Time
	RightHash string
	AgreedAt  time.Time
	// InFlux marks a record SentInFlux made rather than one read from the
	// table. It is never stored.
	InFlux bool
}

// DB is the state store for a single sync job.
type DB struct {
	sql *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS meta (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
	path        TEXT PRIMARY KEY,
	left_path   TEXT NOT NULL DEFAULT '',
	right_path  TEXT NOT NULL DEFAULT '',
	left_size   INTEGER NOT NULL,
	left_mod    INTEGER NOT NULL,
	left_hash   TEXT NOT NULL,
	right_size  INTEGER NOT NULL,
	right_mod   INTEGER NOT NULL,
	right_hash  TEXT NOT NULL,
	agreed_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dirs (
	path        TEXT PRIMARY KEY,
	left_path   TEXT NOT NULL,
	right_path  TEXT NOT NULL,
	agreed_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kept (
	path        TEXT PRIMARY KEY,
	decided_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS asides (
	path        TEXT PRIMARY KEY,
	reason      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flux (
	path        TEXT PRIMARY KEY,
	runs        INTEGER NOT NULL,
	left_path   TEXT NOT NULL DEFAULT '',
	right_path  TEXT NOT NULL DEFAULT '',
	sent_size   INTEGER NOT NULL DEFAULT 0,
	sent_mod    INTEGER NOT NULL DEFAULT 0,
	sent_hash   TEXT NOT NULL DEFAULT '',
	sent_side   TEXT NOT NULL DEFAULT ''
);
`

// version is the state database's layout. It goes up when a newer layout
// would be misread by this build.
const version = 1

// Open opens or creates the state database at path.
func Open(ctx context.Context, path string) (*DB, error) {
	if err := dbfile.EnsureDir(path); err != nil {
		return nil, err
	}
	// _txlock=immediate makes a write transaction take the write lock up front
	// instead of upgrading mid-transaction, which is where SQLITE_BUSY comes
	// from when two runs of the same job overlap.
	handle, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("open state db: %w", err)
	}
	// Transfer workers write records concurrently. With a connection each they
	// contend for SQLite's write lock, and on a slow disk the busy timeout
	// expires and a record is lost without the transfer failing. The writes
	// are tiny, so one connection costs nothing.
	handle.SetMaxOpenConns(1)

	if err := dbfile.Stamp(ctx, handle, path, version); err != nil {
		handle.Close()
		return nil, err
	}
	if _, err := handle.ExecContext(ctx, schema); err != nil {
		handle.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}
	return &DB{sql: handle}, nil
}

// Close releases the database handle.
func (d *DB) Close() error { return d.sql.Close() }

// All returns the complete last-agreed state, keyed by relative path.
func (d *DB) All(ctx context.Context) (map[string]Entry, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT path, left_path, right_path, left_size, left_mod, left_hash, right_size, right_mod, right_hash, agreed_at FROM entries`)
	if err != nil {
		return nil, fmt.Errorf("read state: %w", err)
	}
	defer rows.Close()

	out := make(map[string]Entry)
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		out[e.Path] = e
	}
	return out, rows.Err()
}

// Put records that both sides now agree on this file. It is called per file as
// the plan is applied, so a run that dies halfway leaves a state that is
// incomplete but never wrong.
func (d *DB) Put(ctx context.Context, e Entry) error {
	_, err := d.sql.ExecContext(ctx,
		`INSERT INTO entries (path, left_path, right_path, left_size, left_mod, left_hash, right_size, right_mod, right_hash, agreed_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET
		   left_path=excluded.left_path, right_path=excluded.right_path,
		   left_size=excluded.left_size, left_mod=excluded.left_mod, left_hash=excluded.left_hash,
		   right_size=excluded.right_size, right_mod=excluded.right_mod, right_hash=excluded.right_hash,
		   agreed_at=excluded.agreed_at`,
		e.Path, e.LeftPath, e.RightPath, e.LeftSize, e.LeftMod.UnixNano(), e.LeftHash,
		e.RightSize, e.RightMod.UnixNano(), e.RightHash, e.AgreedAt.UnixNano())
	if err != nil {
		return fmt.Errorf("put state %q: %w", e.Path, err)
	}
	if _, err := d.sql.ExecContext(ctx, `DELETE FROM flux WHERE path = ?`, e.Path); err != nil {
		return fmt.Errorf("forget that %q was in flux: %w", e.Path, err)
	}
	return nil
}

// Sent is what a copy left on its destination when the source changed while
// it was sent: the file as the destination held it right after the copy, and
// which side the destination is, "left" or "right".
type Sent struct {
	Side      string
	LeftPath  string
	RightPath string
	Size      int64
	Mod       time.Time
	Hash      string
}

// InFlux counts one more run that met this file while it was being written,
// and returns how many runs in a row that makes. Put and Forget end the count.
// sent is what the copy left on the destination, or nil when it left nothing;
// what an earlier run left is kept until a later copy leaves something else.
func (d *DB) InFlux(ctx context.Context, path string, sent *Sent) (int, error) {
	var runs int
	var err error
	if sent == nil {
		err = d.sql.QueryRowContext(ctx,
			`INSERT INTO flux (path, runs) VALUES (?, 1)
			 ON CONFLICT(path) DO UPDATE SET runs = runs + 1
			 RETURNING runs`, path).Scan(&runs)
	} else {
		err = d.sql.QueryRowContext(ctx,
			`INSERT INTO flux (path, runs, left_path, right_path, sent_size, sent_mod, sent_hash, sent_side) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(path) DO UPDATE SET runs = runs + 1,
			   left_path = excluded.left_path, right_path = excluded.right_path,
			   sent_size = excluded.sent_size, sent_mod = excluded.sent_mod, sent_hash = excluded.sent_hash,
			   sent_side = excluded.sent_side
			 RETURNING runs`,
			path, sent.LeftPath, sent.RightPath, sent.Size, sent.Mod.UnixNano(), sent.Hash, sent.Side).Scan(&runs)
	}
	if err != nil {
		return 0, fmt.Errorf("count the runs %q was in flux: %w", path, err)
	}
	return runs, nil
}

// SentInFlux returns, for each file a copy left on its destination while the
// source changed, a record to plan against in place of the real one. Its
// destination side is what the copy left there, so the next run sees that
// side unchanged while it still holds exactly that. Its source side matches
// nothing, so the source counts as changed even where it kept its size and
// time, and is sent again. A destination changed since is a conflict, as it
// would be against the real record.
func (d *DB) SentInFlux(ctx context.Context) (map[string]Entry, error) {
	rows, err := d.sql.QueryContext(ctx,
		`SELECT path, left_path, right_path, sent_size, sent_mod, sent_hash, sent_side FROM flux WHERE sent_side <> ''`)
	if err != nil {
		return nil, fmt.Errorf("read what was sent while in flux: %w", err)
	}
	defer rows.Close()

	out := make(map[string]Entry)
	for rows.Next() {
		var e Entry
		var size, mod int64
		var hash, side string
		if err := rows.Scan(&e.Path, &e.LeftPath, &e.RightPath, &size, &mod, &hash, &side); err != nil {
			return nil, fmt.Errorf("scan flux row: %w", err)
		}
		// A size no file has.
		e.LeftSize, e.RightSize = -1, -1
		if side == "left" {
			e.LeftSize, e.LeftMod, e.LeftHash = size, time.Unix(0, mod).UTC(), hash
		} else {
			e.RightSize, e.RightMod, e.RightHash = size, time.Unix(0, mod).UTC(), hash
		}
		e.InFlux = true
		out[e.Path] = e
	}
	return out, rows.Err()
}

// Forget drops a path, meaning both sides agree it is gone. A decision to keep
// it goes with it, so a later file of the same name starts undecided.
func (d *DB) Forget(ctx context.Context, path string) error {
	if _, err := d.sql.ExecContext(ctx, `DELETE FROM entries WHERE path = ?`, path); err != nil {
		return fmt.Errorf("forget state %q: %w", path, err)
	}
	if _, err := d.sql.ExecContext(ctx, `DELETE FROM kept WHERE path = ?`, path); err != nil {
		return fmt.Errorf("forget the decision on %q: %w", path, err)
	}
	if _, err := d.sql.ExecContext(ctx, `DELETE FROM asides WHERE path = ?`, path); err != nil {
		return fmt.Errorf("forget why %q was set aside: %w", path, err)
	}
	if _, err := d.sql.ExecContext(ctx, `DELETE FROM flux WHERE path = ?`, path); err != nil {
		return fmt.Errorf("forget that %q was in flux: %w", path, err)
	}
	return nil
}

// Get returns the record of one path, and false when there is none.
func (d *DB) Get(ctx context.Context, path string) (Entry, bool, error) {
	rows, err := d.query(ctx, `WHERE path = ?`, path)
	if err != nil || len(rows) == 0 {
		return Entry{}, false, err
	}
	return rows[0], true, nil
}

// Containing returns the records whose path holds fragment, without reading
// the whole record into memory.
func (d *DB) Containing(ctx context.Context, fragment string) ([]Entry, error) {
	// instr rather than LIKE, which would read an underscore in the fragment
	// as a wildcard.
	return d.query(ctx, `WHERE instr(path, ?) > 0`, fragment)
}

func (d *DB) query(ctx context.Context, where string, args ...any) ([]Entry, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT path, left_path, right_path, left_size, left_mod, left_hash, right_size, right_mod, right_hash, agreed_at FROM entries `+where, args...)
	if err != nil {
		return nil, fmt.Errorf("read state: %w", err)
	}
	defer rows.Close()

	var out []Entry
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func scanEntry(rows *sql.Rows) (Entry, error) {
	var e Entry
	var leftMod, rightMod, agreed int64
	if err := rows.Scan(&e.Path, &e.LeftPath, &e.RightPath, &e.LeftSize, &leftMod, &e.LeftHash, &e.RightSize, &rightMod, &e.RightHash, &agreed); err != nil {
		return Entry{}, fmt.Errorf("scan state row: %w", err)
	}
	e.LeftMod = time.Unix(0, leftMod)
	e.RightMod = time.Unix(0, rightMod)
	e.AgreedAt = time.Unix(0, agreed)
	return e, nil
}

// Keep records that somebody looked at a file and chose to leave it where it
// is. The engine asks for this about the version a conflict set aside, which
// otherwise waits for a decision.
func (d *DB) Keep(ctx context.Context, path string, at time.Time) error {
	_, err := d.sql.ExecContext(ctx,
		`INSERT INTO kept (path, decided_at) VALUES (?, ?)
		 ON CONFLICT(path) DO UPDATE SET decided_at=excluded.decided_at`,
		path, at.UnixNano())
	if err != nil {
		return fmt.Errorf("keep %q: %w", path, err)
	}
	return nil
}

// Kept returns every path somebody chose to keep.
func (d *DB) Kept(ctx context.Context) (map[string]bool, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT path FROM kept`)
	if err != nil {
		return nil, fmt.Errorf("read kept: %w", err)
	}
	defer rows.Close()

	out := make(map[string]bool)
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			return nil, fmt.Errorf("scan kept row: %w", err)
		}
		out[path] = true
	}
	return out, rows.Err()
}

// SetAside records why a run set a version aside, as the reason code the plan
// gave the conflict, so the version can still say so once the run is over.
func (d *DB) SetAside(ctx context.Context, path, reason string) error {
	_, err := d.sql.ExecContext(ctx,
		`INSERT INTO asides (path, reason) VALUES (?, ?)
		 ON CONFLICT(path) DO UPDATE SET reason=excluded.reason`,
		path, reason)
	if err != nil {
		return fmt.Errorf("record why %q was set aside: %w", path, err)
	}
	return nil
}

// AsideReasons returns why each set-aside version was set aside. A version
// set aside by an older build has no row.
func (d *DB) AsideReasons(ctx context.Context) (map[string]string, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT path, reason FROM asides`)
	if err != nil {
		return nil, fmt.Errorf("read the set-aside reasons: %w", err)
	}
	defer rows.Close()

	out := make(map[string]string)
	for rows.Next() {
		var path, reason string
		if err := rows.Scan(&path, &reason); err != nil {
			return nil, fmt.Errorf("scan set-aside row: %w", err)
		}
		out[path] = reason
	}
	return out, rows.Err()
}

// Count returns how many files the last agreed state covers. The mass-delete
// brake measures against it rather than a live listing, which reads zero for a
// side that failed to mount.
func (d *DB) Count(ctx context.Context) (int, error) {
	var n int
	err := d.sql.QueryRowContext(ctx, `SELECT COUNT(*) FROM entries`).Scan(&n)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("count state: %w", err)
	}
	return n, nil
}

// Dir is one directory both sides were known to hold. Directories are only
// recorded for jobs that sync empty ones, for the same reason files are.
type Dir struct {
	Path      string
	LeftPath  string
	RightPath string
	AgreedAt  time.Time
}

// AllDirs returns every directory both sides were known to hold.
func (d *DB) AllDirs(ctx context.Context) (map[string]Dir, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT path, left_path, right_path, agreed_at FROM dirs`)
	if err != nil {
		return nil, fmt.Errorf("read dirs: %w", err)
	}
	defer rows.Close()

	out := make(map[string]Dir)
	for rows.Next() {
		var e Dir
		var agreed int64
		if err := rows.Scan(&e.Path, &e.LeftPath, &e.RightPath, &agreed); err != nil {
			return nil, fmt.Errorf("scan dir row: %w", err)
		}
		e.AgreedAt = time.Unix(0, agreed)
		out[e.Path] = e
	}
	return out, rows.Err()
}

// PutDir records that both sides hold this directory.
func (d *DB) PutDir(ctx context.Context, e Dir) error {
	_, err := d.sql.ExecContext(ctx,
		`INSERT INTO dirs (path, left_path, right_path, agreed_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET
		   left_path=excluded.left_path, right_path=excluded.right_path, agreed_at=excluded.agreed_at`,
		e.Path, e.LeftPath, e.RightPath, e.AgreedAt.UnixNano())
	if err != nil {
		return fmt.Errorf("put dir %q: %w", e.Path, err)
	}
	return nil
}

// ForgetDir drops a directory, meaning both sides agree it is gone.
func (d *DB) ForgetDir(ctx context.Context, path string) error {
	if _, err := d.sql.ExecContext(ctx, `DELETE FROM dirs WHERE path = ?`, path); err != nil {
		return fmt.Errorf("forget dir %q: %w", path, err)
	}
	return nil
}
