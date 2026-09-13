package engine

import (
	"context"
	"sort"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/accounting"
	"github.com/rclone/rclone/fs/rc"
)

// Moving is one file that is in the air right now.
//
// jdp: "autosync zeigt in der übersicht immer die einzelnen dateien die grade
// hoch und runtergeladen werden mit progress bar. je nachdem wie viele up und
// downloads man gleichzeitig eingestellt hat."
//
// That last clause is the whole shape of this: there is never a fixed number of
// these. rclone runs `transfers` files at once, so a job set to four has up to
// four of them and a job set to one has one, and a screen drawing them gets the
// setting for free by drawing what it is given.
//
// Separate from the progress EVENTS the run already publishes, and the
// difference is worth being exact about. An event says a step FINISHED - this
// file was copied, that one went to the bin - and it is a fact that stays true.
// A Moving is a file part-way across, which is true for a second and then is
// not. One is a log, the other is a gauge.
type Moving struct {
	// Path as the side it is landing on knows it.
	Path string `json:"path"`
	// Bytes across so far, and Size the whole file. Size is -1 where the
	// service did not say, which is ordinary on some clouds - a bar cannot be
	// drawn from it, and a screen that treated it as zero would draw a full one.
	Bytes int64 `json:"bytes"`
	Size  int64 `json:"size"`
	// Side is where it lands, "left" or "right", or empty where the transfer
	// names a destination this run does not recognise. Empty rather than
	// guessed: an arrow pointing the wrong way is worse than no arrow.
	Side string `json:"side,omitempty"`
}

/*
InFlight is what the run in this context has in the air.

Read from rclone's own accounting rather than counted here, because rclone is
what moves the bytes. It keeps a live map of transfers with the bytes across so
far, and `RemoteStats` is the published way to that map.

THE CONTEXT DECIDES WHOSE. `accounting.Stats` returns the stats group named in
the context, so a run that was started under its own group reports only its own
files. Without a group per run, two jobs syncing at once would each report the
other's files as well - which is not a rendering bug but a lie about what is
happening.

An empty result is the ordinary case, not a failure: most of a run is spent
listing, comparing and writing state, with nothing in the air at all.
*/
func InFlight(ctx context.Context, right fs.Fs) []Moving {
	stats := accounting.Stats(ctx)
	if stats == nil {
		return nil
	}
	raw, err := stats.RemoteStats(false)
	if err != nil {
		// A reading that cannot be taken is no reading. This is a gauge, and a
		// gauge that cannot be read shows nothing rather than a guess.
		return nil
	}
	// `rc.Params` and not `map[string]any`, even though that is what it is
	// underneath. Go compares the NAMED type in an assertion, so asking for
	// `[]map[string]any` here fails against `[]rc.Params` and the whole reading
	// comes back empty - silently, because an empty list is also the ordinary
	// answer. Written down because it cost a build to notice.
	list, ok := raw["transferring"].([]rc.Params)
	if !ok {
		return nil
	}

	rightName := fs.ConfigString(right)
	out := make([]Moving, 0, len(list))
	for _, entry := range list {
		name, _ := entry["name"].(string)
		if name == "" {
			continue
		}
		m := Moving{Path: name, Size: -1}
		m.Bytes = whole(entry["bytes"])
		if size := whole(entry["size"]); size > 0 {
			m.Size = size
		}
		// Which way it is going, from the destination rclone names. A file
		// landing on the right came from the left, which is the same fact the
		// finished lines carry and the same word they use for it.
		if dst, _ := entry["dstFs"].(string); dst != "" {
			if dst == rightName {
				m.Side = "right"
			} else {
				m.Side = "left"
			}
		}
		out = append(out, m)
	}
	// A stable order, so a row does not jump between two frames because rclone's
	// map iterated differently. By path, which is the one thing about a
	// transfer that does not change while it runs.
	sort.Slice(out, func(a, b int) bool { return out[a].Path < out[b].Path })
	return out
}

// whole reads a number that arrived as any of the shapes JSON and Go produce.
//
// rclone fills these from int64 fields, but the same values come back as
// float64 once they have been through JSON, and this function is called on
// both sides of that line depending on who is asking.
func whole(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}
