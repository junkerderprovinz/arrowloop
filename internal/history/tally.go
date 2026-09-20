package history

import (
	"context"
	"fmt"
)

// Tally is what one run did, split by the side each file landed on. The run
// record carries no direction, so this counts the entries, and it counts them
// in the database because the entries endpoint only hands back one page.
type Tally struct {
	// Up is files that landed on the right, Down files that landed on the
	// left. The right side is the cloud in nearly every job.
	Up   int `json:"up"`
	Down int `json:"down"`
	// Trashed is files that went to a bin, Conflicts the ones kept twice.
	Trashed   int `json:"trashed"`
	Conflicts int `json:"conflicts"`
	// TrashedLeft and TrashedRight split Trashed by the side the files were
	// removed from, so a two-way job says which end lost them.
	TrashedLeft  int `json:"trashedLeft"`
	TrashedRight int `json:"trashedRight"`
}

// Summarise counts one run's entries by what happened and where it landed.
// Only copies count towards up and down: a move also writes a line for the
// source going away, and counting it would make a one-way move look two-way.
func (d *DB) Summarise(ctx context.Context, run int64) (Tally, error) {
	rows, err := d.sql.QueryContext(ctx,
		`SELECT kind, side, COUNT(*) FROM entries WHERE run = ? GROUP BY kind, side`, run)
	if err != nil {
		return Tally{}, fmt.Errorf("summarise run %d: %w", run, err)
	}
	defer rows.Close()

	var out Tally
	for rows.Next() {
		var kind, side string
		var n int
		if err := rows.Scan(&kind, &side, &n); err != nil {
			return Tally{}, fmt.Errorf("scan summary: %w", err)
		}
		switch kind {
		case "copy":
			if side == "right" {
				out.Up += n
			} else {
				out.Down += n
			}
		case "trash":
			out.Trashed += n
			// The side is where the file was. A line with no side counts in
			// the total and in neither half.
			if side == "right" {
				out.TrashedRight += n
			} else if side == "left" {
				out.TrashedLeft += n
			}
		case "conflict":
			out.Conflicts += n
		}
	}
	return out, rows.Err()
}
