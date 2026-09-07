package trash

import (
	"errors"
	"fmt"
	"path"
	"strings"
)

// Everything in this file exists because a caller names an entry over the wire,
// and a name that arrives over the wire is not a name until it has been proved
// to be one.
//
// The precedent is internal/web/browse.go, where a folder name is refused rather
// than cleaned, and internal/web/state.go, where the only thing a caller may
// send is a job NAME that is then looked up in the configuration. Neither of
// those has to accept a path at all. A trash entry does: it was a file at some
// depth in the tree and it is still filed under that depth, so "restore
// photos/2019/wedding.jpg" is the only sentence that identifies it. That is the
// difference, and it is why the checks here are stricter than a Clean call.

// ErrNotAName is the class of refusal every check in this file returns, so that
// a caller can answer one status code for the whole family without matching on
// wording.
var ErrNotAName = errors.New("this is not a name inside the reserved directory")

// checkSegment refuses anything that is not ONE plain name.
//
// A run identifier is one segment and a side is one word, so both go through
// here rather than through CheckRel: a run identifier that arrived containing a
// slash would address a directory the caller was never shown, and the confinement
// check further down would still pass because the result would still sit under
// the reserved directory. Confinement is not the only property worth having.
//
// Both separators are refused on every platform, not the host's own. That is the
// bug internal/web/browse.go already found and wrote down: filepath.Separator is
// "/" on Linux and macOS, so a check written against it lets a backslash through
// there, and the same string on Windows is a directory separator that walks out
// of the tree. It was measured: with a root of D:\job\left, the remote
// ".arrowloop/trash/run/..\..\..\evil" resolves through rclone's local backend to
// D:\job\left\evil, which is outside the trash and inside the user's data.
func checkSegment(seg string) error {
	switch {
	case seg == "":
		return fmt.Errorf("%w: an empty name addresses nothing", ErrNotAName)
	case seg == "." || seg == "..":
		return fmt.Errorf("%w: %q is a step through the tree rather than something in it", ErrNotAName, seg)
	case strings.ContainsAny(seg, `/`+"\\"):
		return fmt.Errorf("%w: %q is a path, not a single name", ErrNotAName, seg)
	case strings.ContainsRune(seg, 0):
		return fmt.Errorf("%w: this name carries a zero byte, which truncates it somewhere below here", ErrNotAName)
	}
	return nil
}

// CheckRel proves that a path sent by a caller is a relative path inside the
// tree and nothing else.
//
// It is deliberately a refusal and never a repair. path.Clean would turn
// "a/../../b" into "../b" and hand back something that still escapes, and it
// would turn "a/../b" into "b" and hand back a path the caller did not ask for.
// Both are worse than saying no: the first is the hole, and the second means a
// restore lands somewhere the person reading the screen was not told about.
//
// A backslash is refused outright, which does cost something honest and is worth
// writing down. An S3 key or an SFTP name may legally contain one, and such an
// entry cannot be restored through this API. That is the trade taken on purpose:
// the same string on a Windows side is a separator that leaves the reserved
// directory, and there is no way to tell the two apart from here. A name like
// that is still visible in a listing, and it can still be recovered by hand.
func CheckRel(rel string) (string, error) {
	if rel == "" {
		return "", fmt.Errorf("%w: an empty path addresses nothing", ErrNotAName)
	}
	if rooted(rel) {
		return "", fmt.Errorf("%w: %q is rooted, and everything here is relative to one side of one job", ErrNotAName, rel)
	}
	for _, seg := range strings.Split(rel, "/") {
		if err := checkSegment(seg); err != nil {
			return "", err
		}
	}
	return rel, nil
}

// rooted reports whether a path names where it starts from, which no path here
// is ever allowed to do.
//
// The leading slash is the obvious half. The drive designator is the half that
// was nearly missed, and it is not caught by the segment rules: "C:/Windows/x"
// splits into three perfectly ordinary-looking names. It was measured that such
// a path does not actually escape, because rclone's local backend joins it onto
// the side's root and Windows resolves D:\job\left\C:\Windows\x inside the side.
// Refusing it is therefore not about confinement, it is about meaning: a restore
// of "C:/Windows/x" would silently create a folder literally called "C:" in
// somebody's data, and a caller sending that string plainly meant something else.
//
// Checked with a string comparison rather than with filepath.VolumeName,
// deliberately. filepath answers according to the machine this process happens to
// be running on, and the side being addressed can be an S3 bucket reached from a
// Linux container, so a host-dependent answer here would let the same request
// mean two things.
//
// The leading slash is already caught downstream, because "/etc/passwd" splits
// into an empty first segment and checkSegment refuses that. It was mutated out
// on its own and every test stayed green. It stays anyway, as the sentence that
// says what is meant: the empty-segment rule catches it for a reason that has
// nothing to do with roots, and a later reader tightening one of the two has no
// way to know the other was carrying it.
//
// A file legitimately named "c:something" at the top of a Linux or S3 side is
// refused by this and cannot be restored through the API. That is the cost, it is
// small, and such an entry is still listed and still recoverable by hand.
func rooted(rel string) bool {
	if strings.HasPrefix(rel, "/") {
		return true
	}
	if len(rel) >= 2 && rel[1] == ':' {
		c := rel[0]
		return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
	}
	return false
}

// under joins parts onto a reserved directory and then proves the result is
// still under it.
//
// This is the last line rather than the first. Every caller that takes a value
// from the wire runs CheckRel or checkSegment first, and if all of them keep
// doing so this check can never fire. It stays because "all of them keep doing
// so" is a property of code that has not been written yet: the day somebody adds
// a fourth entry point and reaches for path.Join directly, this is what stops the
// mistake being a hole in somebody's photo folder. It is cheap, it is one string
// comparison, and the thing it guards is not recoverable.
//
// path.Join cleans, so a part that still carries ".." collapses here and the
// prefix comparison is what notices. That is the case the unit test drives
// directly, because it cannot be reached through the exported functions.
func under(dir string, parts ...string) (string, error) {
	full := path.Join(append([]string{dir}, parts...)...)
	if full != dir && !strings.HasPrefix(full, dir+"/") {
		return "", fmt.Errorf("%w: %q would leave %s", ErrNotAName, full, dir)
	}
	return full, nil
}
