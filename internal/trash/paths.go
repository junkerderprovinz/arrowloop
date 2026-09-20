package trash

import (
	"errors"
	"fmt"
	"path"
	"strings"
)

// Callers name trash entries by path over the wire, so the checks here refuse
// rather than clean, and are stricter than path.Clean.

// ErrNotAName is the refusal every check in this file returns, so a caller can
// answer one status code for all of them.
var ErrNotAName = errors.New("this is not a name inside the reserved directory")

// checkSegment refuses anything that is not one plain name.
//
// Both separators are refused on every platform: a backslash is an ordinary
// character on Linux but a separator on a Windows side, where
// ".arrowloop/trash/run/..\..\..\evil" resolves outside the trash.
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

// CheckRel checks that a path sent by a caller is a relative path inside the
// tree. It refuses instead of cleaning, because path.Clean can still escape
// ("a/../../b") or quietly change the target ("a/../b").
//
// A backslash is always refused, so an S3 or SFTP name containing one cannot
// be restored through the API; it is still listed and can be recovered by
// hand.
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

// rooted reports whether a path starts with a slash or a drive letter.
//
// "C:/Windows/x" does not escape the side, but restoring it would create a
// folder called "C:" in the user's data. The check is a string comparison
// rather than filepath.VolumeName, which answers for the host rather than the
// backend. The leading slash is also caught by the empty-segment rule, but is
// checked here for what it means.
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

// under joins parts onto a reserved directory and checks the result is still
// under it. Callers taking wire values check them first; this is the last line
// for a future caller that does not.
func under(dir string, parts ...string) (string, error) {
	full := path.Join(append([]string{dir}, parts...)...)
	if full != dir && !strings.HasPrefix(full, dir+"/") {
		return "", fmt.Errorf("%w: %q would leave %s", ErrNotAName, full, dir)
	}
	return full, nil
}
