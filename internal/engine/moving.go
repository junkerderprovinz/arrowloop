package engine

import (
	"context"
	"sort"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/accounting"
	"github.com/rclone/rclone/fs/rc"
)

// Moving is one file that is being transferred right now. There are as many as
// the job's transfers setting allows. Unlike a progress event, which records a
// finished step, a Moving is only true for a moment.
type Moving struct {
	// Path as the side it is landing on knows it.
	Path string `json:"path"`
	// Bytes is how much has been transferred and Size the whole file, or -1
	// where the backend did not say.
	Bytes int64 `json:"bytes"`
	Size  int64 `json:"size"`
	// Side is where it lands, "left" or "right", or empty when rclone names no
	// destination.
	Side string `json:"side,omitempty"`
}

// InFlight returns the transfers in progress for the run in this context, read
// from rclone's accounting. accounting.Stats returns the stats group named in
// the context, so a run started under its own group sees only its own files.
func InFlight(ctx context.Context, right fs.Fs) []Moving {
	stats := accounting.Stats(ctx)
	if stats == nil {
		return nil
	}
	raw, err := stats.RemoteStats(false)
	if err != nil {
		return nil
	}
	// The assertion has to name rc.Params: []map[string]any is a different
	// type and would silently match nothing.
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
		if dst, _ := entry["dstFs"].(string); dst != "" {
			if dst == rightName {
				m.Side = "right"
			} else {
				m.Side = "left"
			}
		}
		out = append(out, m)
	}
	// Sorted so rows keep their place between two readings.
	sort.Slice(out, func(a, b int) bool { return out[a].Path < out[b].Path })
	return out
}

// whole reads a number that is an int64 from rclone or a float64 after a trip
// through JSON.
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
