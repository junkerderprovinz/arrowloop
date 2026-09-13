package history

import (
	"context"
	"fmt"
)

/*
Tally is what one run did, split by the side each line landed on.

jdp asked the sync-status card for "eine kleine zusammenfassung wie viele
datien hoch- und runtergeladen und gelöscht wurden etc." The run record itself
cannot answer that: it counts copies, moves and deletions, and none of those
carry a direction. The direction is on the ENTRIES, one per file, where every
line says which side it landed on.

COUNTED IN THE DATABASE rather than by reading the lines back. A run over three
thousand files writes six thousand lines, and the entries endpoint hands back a
page of two hundred - so counting what arrived would have reported "200
uploaded" for a run that uploaded three thousand, confidently and quietly.
*/
type Tally struct {
	// Up is files that landed on the RIGHT, Down files that landed on the left.
	//
	// Up and down rather than left and right, because that is what somebody
	// reads it as: the right-hand side of a job is the cloud in nearly every
	// job anybody writes, and "12 hochgeladen" is the sentence they want. For a
	// job between two local folders the words are a stretch and the arrows on
	// the log say the same thing more precisely - but the count is still right.
	Up   int `json:"up"`
	Down int `json:"down"`
	// Trashed is files that went to a bin, Conflicts the ones kept twice.
	Trashed   int `json:"trashed"`
	Conflicts int `json:"conflicts"`
}

/*
Summarise counts one run's lines by what happened and where it landed.

Only COPIES count towards up and down. A move writes two lines - the copy that
landed, and the source going away - and counting the second as a download would
turn every one-way move job into a job that moves files in both directions.
*/
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
		case "conflict":
			out.Conflicts += n
		}
	}
	return out, rows.Err()
}
