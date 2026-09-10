// Package dupes finds files whose CONTENT is identical, wherever they sit.
//
// It is not rclone's `dedupe`, which is about one remote holding two objects
// under the same NAME - a thing only Google Drive really does. This is the
// question somebody asks about their own folder: the same holiday photos under
// three different names, an archive unpacked twice, a backup of a backup. jdp
// asked for it among the small ones, and it earns its place on a sync tool
// because duplicates are paid for twice - once in space on this side, once in
// transfer to the other.
package dupes

import (
	"context"
	"sort"

	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// Group is one piece of content and every place it was found.
type Group struct {
	// Hash is the content's MD5, which is what made these one group.
	Hash string `json:"hash"`
	// Size is one copy's size. They are all the same size by construction.
	Size int64 `json:"size"`
	// Paths, sorted, and always at least two long.
	Paths []string `json:"paths"`
	// Wasted is what the extra copies cost: every copy but the first. The
	// first one is the file, not a duplicate of it, and a total that counts it
	// tells somebody they would get back more than deleting can ever return.
	Wasted int64 `json:"wasted"`
}

// Report is what a search found, and what it could not look at.
type Report struct {
	Groups []Group `json:"groups"`
	// Wasted is the sum of the groups' waste: what deleting the extra copies
	// would actually return.
	Wasted int64 `json:"wasted"`
	// Scanned is how many files were considered at all.
	Scanned int `json:"scanned"`
	// Unhashable is how many candidates the backend refused to hash.
	//
	// It is reported rather than swallowed because it is the one thing that
	// makes this answer incomplete, and the alternative is worse than silence:
	// two files of the same size on a hashless backend are NOT duplicates, and
	// pairing them up would offer somebody a delete button over two files that
	// merely happen to weigh the same.
	Unhashable int `json:"unhashable"`
}

// Find walks one side and returns every set of identical files.
//
// The cheap filter first, and it is what makes this affordable at all: two
// files can only be identical if they are the same SIZE, and a size that only
// one file has cannot be part of a duplicate set. On a real tree that removes
// almost everything before a single byte is hashed. Hashing the whole tree
// instead would cost more than the sync it is supposed to save.
//
// Empty files are left out entirely. Every zero-byte file matches every other
// one, so including them turns the answer into a list of placeholder files,
// `.gitkeep` and half-finished downloads, with nothing to reclaim: the waste is
// zero bytes by definition. That is noise standing where the finding should be.
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
			// A cancelled search stops here rather than at the end. Hashing is
			// the expensive half and a tree can hold a lot of it.
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

	// Biggest waste first, because that is the order somebody would work in:
	// one duplicated film is worth more than four hundred duplicated icons.
	// Ties settle on the first path so the list does not reshuffle itself
	// between two identical searches.
	sort.Slice(out.Groups, func(i, j int) bool {
		if out.Groups[i].Wasted != out.Groups[j].Wasted {
			return out.Groups[i].Wasted > out.Groups[j].Wasted
		}
		return out.Groups[i].Paths[0] < out.Groups[j].Paths[0]
	})

	// The cap applies to what is SENT and never to what was counted. The walk
	// had to read the whole tree to answer at all, so the totals above are the
	// real ones and stay the real ones - a total computed from a truncated list
	// would under-report the waste and quietly reward a smaller screen.
	if limit > 0 && len(out.Groups) > limit {
		out.Groups = out.Groups[:limit]
	}
	if out.Groups == nil {
		out.Groups = []Group{}
	}
	return out, nil
}
