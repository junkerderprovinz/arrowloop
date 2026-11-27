package remotes

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	_ "github.com/rclone/rclone/backend/compress"
	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configmap"
)

// compressLevels is the range of levels each compression mode takes, and the
// level a target that names none gets.
var compressLevels = map[string]struct{ low, high, usual int }{
	"gzip": {-2, 9, -1},
	"zstd": {1, 4, 2},
}

// rclone 1.76.0 opens a compressed target with level 0 when none is set, which
// gzip stores uncompressed and zstd cannot encode at all, and a level the
// encoder refuses leaves the first compressible upload waiting forever
// (rclone/rclone#10227). Until a release carries the fix, a target without a
// level gets the mode's usual one and a level out of range fails on opening.
func init() {
	wrap("compress", func(next newFs) newFs {
		return func(ctx context.Context, name, root string, m configmap.Mapper) (rclonefs.Fs, error) {
			mode, _ := m.Get("mode")
			mode = strings.TrimSpace(mode)
			if mode == "" {
				mode = "gzip"
			}
			levels, known := compressLevels[mode]
			if !known {
				return next(ctx, name, root, m)
			}
			level := levels.usual
			if raw, _ := m.Get("level"); strings.TrimSpace(raw) != "" {
				n, err := strconv.Atoi(strings.TrimSpace(raw))
				if err != nil {
					return next(ctx, name, root, m)
				}
				if n != -1 {
					level = n
				}
			}
			if level < levels.low || level > levels.high {
				return nil, fmt.Errorf("%s compression takes a level from %d to %d, not %d", mode, levels.low, levels.high, level)
			}
			return next(ctx, name, root, overridden{Mapper: m, values: map[string]string{"level": strconv.Itoa(level)}})
		}
	})
}
