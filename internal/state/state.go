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
`

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
		var e Entry
		var leftMod, rightMod, agreed int64
		if err := rows.Scan(&e.Path, &e.LeftPath, &e.RightPath, &e.LeftSize, &leftMod, &e.LeftHash, &e.RightSize, &rightMod, &e.RightHash, &agreed); err != nil {
			return nil, fmt.Errorf("scan state row: %w", err)
		}
		e.LeftMod = time.Unix(0, leftMod)
		e.RightMod = time.Unix(0, rightMod)
		e.AgreedAt = time.Unix(0, agreed)
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
	return nil
}

// Forget drops a path, meaning both sides agree it is gone.
func (d *DB) Forget(ctx context.Context, path string) error {
	if _, err := d.sql.ExecContext(ctx, `DELETE FROM entries WHERE path = ?`, path); err != nil {
		return fmt.Errorf("forget state %q: %w", path, err)
	}
	return nil
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
