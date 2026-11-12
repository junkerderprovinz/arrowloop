package history

import (
	"context"
	"fmt"
	"time"
)

// Opening is another app of the fortress opening this instance's web
// interface, as the fortress log tells the others.
type Opening struct {
	ID int64
	At time.Time
	// App and Device name the app that opened it and where that runs, Member
	// its id in the fortress.
	App    string
	Device string
	Member string
}

// RecordOpening keeps one opening.
func (d *DB) RecordOpening(ctx context.Context, o Opening) error {
	if _, err := d.sql.ExecContext(ctx, `INSERT INTO openings (at, app, device, member) VALUES (?, ?, ?, ?)`,
		o.At.UnixNano(), o.App, o.Device, o.Member); err != nil {
		return fmt.Errorf("record the opening from %s: %w", o.App, err)
	}
	return nil
}

// OpeningsAfter returns up to limit openings recorded after the one with id
// after, oldest first.
func (d *DB) OpeningsAfter(ctx context.Context, after int64, limit int) ([]Opening, error) {
	rows, err := d.sql.QueryContext(ctx,
		`SELECT id, at, app, device, member FROM openings WHERE id > ? ORDER BY id LIMIT ?`, after, limit)
	if err != nil {
		return nil, fmt.Errorf("read the openings after %d: %w", after, err)
	}
	defer rows.Close()
	var out []Opening
	for rows.Next() {
		var o Opening
		var at int64
		if err := rows.Scan(&o.ID, &at, &o.App, &o.Device, &o.Member); err != nil {
			return nil, fmt.Errorf("scan opening: %w", err)
		}
		o.At = time.Unix(0, at)
		out = append(out, o)
	}
	return out, rows.Err()
}
