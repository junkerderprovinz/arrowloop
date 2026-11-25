package history

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// SystemLine is one error from outside a run's own files, such as rclone
// complaining or a server that could not be reached.
type SystemLine struct {
	ID     int64
	At     time.Time
	Source string
	Text   string
	// Count is how many times in a row it came, At being the last of them.
	Count int
}

// SystemLogKeep is how many lines the system log holds, whatever their age,
// so a server that fails every minute cannot fill the disk.
const SystemLogKeep = 500

// AddSystemLog stores lines, oldest first. A line that repeats the one before
// it counts up that one instead of taking a row.
func (d *DB) AddSystemLog(ctx context.Context, lines []SystemLine) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("write the system log: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // a committed transaction rolls back to nothing

	for _, l := range lines {
		count := max(l.Count, 1)
		var id int64
		var source, text string
		err := tx.QueryRowContext(ctx, `SELECT id, source, text FROM system_log ORDER BY id DESC LIMIT 1`).Scan(&id, &source, &text)
		if err != nil && err != sql.ErrNoRows {
			return fmt.Errorf("write the system log: %w", err)
		}
		if err == nil && source == l.Source && text == l.Text {
			_, err = tx.ExecContext(ctx, `UPDATE system_log SET at = ?, count = count + ? WHERE id = ?`, l.At.UnixNano(), count, id)
		} else {
			_, err = tx.ExecContext(ctx, `INSERT INTO system_log (at, source, text, count) VALUES (?, ?, ?, ?)`,
				l.At.UnixNano(), l.Source, l.Text, count)
		}
		if err != nil {
			return fmt.Errorf("write the system log: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM system_log WHERE id <= (SELECT id FROM system_log ORDER BY id DESC LIMIT 1 OFFSET ?)`, SystemLogKeep); err != nil {
		return fmt.Errorf("trim the system log: %w", err)
	}
	return tx.Commit()
}

// SystemLog returns up to limit lines of the system log, newest first.
func (d *DB) SystemLog(ctx context.Context, limit int) ([]SystemLine, error) {
	rows, err := d.sql.QueryContext(ctx,
		`SELECT id, at, source, text, count FROM system_log ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("read the system log: %w", err)
	}
	defer rows.Close()
	var out []SystemLine
	for rows.Next() {
		var l SystemLine
		var at int64
		if err := rows.Scan(&l.ID, &at, &l.Source, &l.Text, &l.Count); err != nil {
			return nil, fmt.Errorf("scan a line of the system log: %w", err)
		}
		l.At = time.Unix(0, at)
		out = append(out, l)
	}
	return out, rows.Err()
}
