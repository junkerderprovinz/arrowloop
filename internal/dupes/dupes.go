// Package dupes finds files with identical content, wherever they sit.
//
// Unlike rclone's dedupe, which handles one remote holding two objects under
// the same name, this looks for the same content under different names in one
// folder. Duplicates are paid for twice on a sync tool: in space here and in
// transfer to the other side.
package dupes

import (
	"context"
	"sort"

	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// Group is one piece of content and every place it was found.
type Group struct {
	// Hash is the content's MD5.
	Hash string `json:"hash"`
	// Size is the size of one copy.
	Size int64 `json:"size"`
	// Paths is sorted and holds at least two entries.
	Paths []string `json:"paths"`
	// Wasted is the size of every copy but the first.
	Wasted int64 `json:"wasted"`
}

// Report is what a search found, and what it could not look at.
type Report struct {
	Groups []Group `json:"groups"`
	// Wasted is the sum of the groups' waste.
	Wasted int64 `json:"wasted"`
	// Scanned is how many files were considered.
	Scanned int `json:"scanned"`
	// Unhashable is how many candidates the backend could not hash. They are
	// counted rather than grouped by size, because equal size does not make
	// two files duplicates.
	Unhashable int `json:"unhashable"`
}

// Find walks one side and returns every set of identical files, at most limit
// groups when limit is positive.
//
// Only files that share their size with another file are hashed, which on a
// real tree rules out almost everything. Empty files are left out: they all
// match each other and deleting them reclaims nothing.
func Find(ctx context.Context, f rclonefs.Fs, opt scan.Options, limit int) (Report, error) {
	listing, err := scan.List(ctx, f, opt)
	if err != nil {
		return Report{}, err
	}

	bySize := map[int64][]*scan.Entry{}
	for _, e := range listing.Files {
		if e.Size <= 0 {
			continue
		}
		bySize[e.Size] = append(bySize[e.Size], e)
	}

	out := Report{Scanned: len(listing.Files)}
	byHash := map[string][]*scan.Entry{}
	for _, sharing := range bySize {
		if len(sharing) < 2 {
			continue
		}
		for _, e := range sharing {
			if err := ctx.Err(); err != nil {
				return Report{}, err
			}
			sum := e.Hash(ctx)
			if sum == "" {
				out.Unhashable++
				continue
			}
			byHash[sum] = append(byHash[sum], e)
		}
	}

	for sum, same := range byHash {
		if len(same) < 2 {
			continue
		}
		group := Group{Hash: sum, Size: same[0].Size, Wasted: same[0].Size * int64(len(same)-1)}
		for _, e := range same {
			group.Paths = append(group.Paths, e.Path)
		}
		sort.Strings(group.Paths)
		out.Groups = append(out.Groups, group)
		out.Wasted += group.Wasted
	}

	// Biggest waste first, ties by first path so repeated searches agree.
	sort.Slice(out.Groups, func(i, j int) bool {
		if out.Groups[i].Wasted != out.Groups[j].Wasted {
			return out.Groups[i].Wasted > out.Groups[j].Wasted
		}
		return out.Groups[i].Paths[0] < out.Groups[j].Paths[0]
	})

	// The limit applies to the list only; the totals stay those of the whole
	// tree.
	if limit > 0 && len(out.Groups) > limit {
		out.Groups = out.Groups[:limit]
	}
	if out.Groups == nil {
		out.Groups = []Group{}
	}
	return out, nil
}
