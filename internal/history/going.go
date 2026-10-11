package history

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strconv"
	"sync"
	"time"
)

// Interrupted is the error a run gets when the program ended before the run
// did. The state of the files it settled was written as it went, so the next
// run starts after them.
const Interrupted = "ArrowLoop stopped while this run was going; the next run picks up where it ended"

// beatEvery is how often the runs going are written down, and staleAfter how
// long a written run may go unwritten before it counts as abandoned. The gap
// leaves room for another program on the same file, whose runs are its own.
var (
	beatEvery  = 5 * time.Second
	staleAfter = time.Minute
)

// beat writes the runs going down in the background, so a program that is
// killed leaves them behind for the next start to record.
type beat struct {
	owner string
	// flushMu keeps a write of the runs going from crossing a record or a
	// drop, which would leave a finished run behind as an abandoned one.
	flushMu sync.Mutex
	stop    chan struct{}
	done    chan struct{}
}

func newOwner() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (d *DB) keyFor(id int64) string {
	return d.owner + ":" + strconv.FormatInt(-id, 10)
}

// keepBeat writes the runs going down, and records the ones another start
// left behind, until Close.
func (d *DB) keepBeat() {
	defer close(d.done)
	tick := time.NewTicker(beatEvery)
	defer tick.Stop()
	for {
		select {
		case <-d.stop:
			return
		case now := <-tick.C:
			_ = d.checkpoint(context.Background(), now)
			_ = d.recordAbandoned(context.Background(), now)
		}
	}
}

// checkpoint writes what every run going has done since the last time.
func (d *DB) checkpoint(ctx context.Context, now time.Time) error {
	d.flushMu.Lock()
	defer d.flushMu.Unlock()

	type part struct {
		l     *Live
		run   Run
		fresh []Entry
		from  int
	}
	d.liveMu.Lock()
	parts := make([]part, 0, len(d.runs))
	for _, l := range d.runs {
		parts = append(parts, part{l: l, run: l.run, fresh: l.entries[l.flushed:len(l.entries):len(l.entries)], from: l.flushed})
	}
	d.liveMu.Unlock()
	if len(parts) == 0 {
		return nil
	}

	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // a committed transaction rolls back to nothing
	for _, p := range parts {
		r := p.run
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO going (key, job, started, beat, copied, moved, trashed, conflicts, dirs_made, dirs_removed, skipped)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (key) DO UPDATE SET beat = excluded.beat, copied = excluded.copied, moved = excluded.moved,
			   trashed = excluded.trashed, conflicts = excluded.conflicts, dirs_made = excluded.dirs_made,
			   dirs_removed = excluded.dirs_removed, skipped = excluded.skipped`,
			p.l.key, r.Job, r.Started.UnixNano(), now.UnixNano(),
			r.Copied, r.Moved, r.Trashed, r.Conflicts, r.DirsMade, r.DirsRemoved, r.Skipped); err != nil {
			return err
		}
		for i, e := range p.fresh {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO going_entries (key, seq, kind, side, path, note, size) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				p.l.key, p.from+i, e.Kind, e.Side, e.Path, e.Note, e.Size); err != nil {
				return err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	d.liveMu.Lock()
	for _, p := range parts {
		p.l.flushed = p.from + len(p.fresh)
	}
	d.liveMu.Unlock()
	return nil
}

// recordAbandoned turns every run another start left behind into a stored run
// that ended with Interrupted, with what it had done by its last beat.
func (d *DB) recordAbandoned(ctx context.Context, now time.Time) error {
	rows, err := d.sql.QueryContext(ctx,
		`SELECT key FROM going WHERE beat < ? AND key NOT LIKE ?`,
		now.Add(-staleAfter).UnixNano(), d.owner+":%")
	if err != nil {
		return err
	}
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			rows.Close()
			return err
		}
		keys = append(keys, k)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, k := range keys {
		if err := d.recordOne(ctx, k); err != nil {
			return fmt.Errorf("record the run left behind as %s: %w", k, err)
		}
	}
	return nil
}

func (d *DB) recordOne(ctx context.Context, key string) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // a committed transaction rolls back to nothing

	// Read inside the transaction, since another program on the same file may
	// have recorded it first.
	var r Run
	var started, last int64
	err = tx.QueryRowContext(ctx,
		`SELECT job, started, beat, copied, moved, trashed, conflicts, dirs_made, dirs_removed, skipped FROM going WHERE key = ?`, key).
		Scan(&r.Job, &started, &last, &r.Copied, &r.Moved, &r.Trashed, &r.Conflicts, &r.DirsMade, &r.DirsRemoved, &r.Skipped)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx,
		`INSERT INTO runs (job, started, finished, copied, moved, trashed, conflicts, dirs_made, dirs_removed, unchanged, skipped, err)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		r.Job, started, last, r.Copied, r.Moved, r.Trashed, r.Conflicts, r.DirsMade, r.DirsRemoved, r.Skipped, Interrupted)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO entries (run, seq, kind, side, path, note, size)
		 SELECT ?, seq, kind, side, path, note, size FROM going_entries WHERE key = ?`, id, key); err != nil {
		return err
	}
	if err := forget(ctx, tx, key); err != nil {
		return err
	}
	return tx.Commit()
}

// forget removes what was written down about a run going.
func forget(ctx context.Context, tx *sql.Tx, key string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM going_entries WHERE key = ?`, key); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM going WHERE key = ?`, key)
	return err
}
