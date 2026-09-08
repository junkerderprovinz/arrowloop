// Package state holds the last agreed state of a sync job.
//
// This is the piece rclone's own bisync does not have, and the reason this
// project exists at all. Without a per-file record of what BOTH sides looked
// like the last time they agreed, "the file is on the left but not on the
// right" is ambiguous: it means either "created on the left" or "deleted on
// the right", and those two readings call for opposite actions. Every two-way
// sync that loses data loses it here.
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
// Hash is best effort. Some backends cannot produce one (plain SFTP without a
// remote shell, for example), so an empty Hash means "unknown", never "empty
// file". Comparisons must treat it that way or a hashless backend turns every
// run into a full re-copy.
//
// Path is the matching key, not a name any backend would recognise. LeftPath
// and RightPath are what each side actually calls the file, which can differ
// from the key and from each other when one side stores names decomposed and
// the other composed. Keeping all three is what lets the engine hand every
// backend a name it will accept while still knowing the two are one file.
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
	// Creating the file is half a promise on its own. A job created in the
	// interface is given a state path of "state/<name>.db", and until this line
	// existed nobody created the folder, so every run of every such job failed
	// with SQLITE_CANTOPEN and a message that mentions a file and not a folder.
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
	// One connection, and therefore one writer.
	//
	// Records are written from every transfer worker at once, so without this
	// the pool hands each of them a connection of its own and they contend for
	// SQLite's single write lock. The busy handler waits, and on a slow disk it
	// waits longer than its timeout: the write fails with SQLITE_BUSY, the file
	// is reported as postponed, and its record is simply not there.
	//
	// That is not a lost transfer, which would be obvious, but a lost RECORD,
	// which is quieter and worse. The file is on both sides and the job has no
	// note of it, so the next run finds it new on both sides with identical
	// content and files it under "appeared on both sides" instead of
	// "unchanged". Nothing is broken and nothing converges.
	//
	// Serialising here rather than leaning on the busy handler costs nothing
	// worth measuring: these writes are a few dozen bytes each and the run is
	// waiting on a network or a disk, not on them. It also means the timeout
	// can never be reached, rather than being reached less often.
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

// Put records that both sides now agree on this file.
//
// Called per file as the plan is applied, not once at the end. A run that dies
// halfway then leaves a state that is smaller than reality but never wrong,
// and the next run picks up from there. The opposite order, writing everything
// at the end, turns every crash into a full resync.
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
// brake measures against this, so it has to come from the state and not from a
// live listing: a side that failed to mount lists zero files, and measuring a
// proposed deletion against zero would make any deletion look proportionate.
func (d *DB) Count(ctx context.Context) (int, error) {
	var n int
	err := d.sql.QueryRowContext(ctx, `SELECT COUNT(*) FROM entries`).Scan(&n)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("count state: %w", err)
	}
	return n, nil
}

// Dir is one directory both sides were known to hold.
//
// Directories are recorded separately from files, and only when the job syncs
// empty ones at all. Without a record there is no way to tell "the user deleted
// this folder over there" from "this folder has simply never existed over
// there", and those call for opposite actions, exactly as they do for files.
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
