// Package filter decides which paths a job is allowed to see at all.
//
// The dangerous part of a filter is not the matching, it is what an excluded
// path means. A file that used to be synced and is now excluded has NOT been
// deleted, and an engine that simply drops it from the listing will read it as
// a deletion and remove it on the other side. Adding one exclude pattern would
// then wipe every matching file the user already had. So a filter has to hide a
// path from the record as well as from both sides, which is why the exclusion
// is applied in one place and handed to everything that reads paths.
package filter

import (
	"fmt"
	"regexp"
	"strings"
)

// InProgress are the names programs use while they are still writing a file.
//
// These are excluded by default and it is not really a filter decision: these
// files are meaningless outside the machine that made them, they exist for
// seconds, and copying one produces a file the other side can never use. Word's
// owner files are the classic case, because they appear next to a document the
// moment somebody opens it and vanish when they close it.
var InProgress = []string{
	"~$*",          // Microsoft Office owner files
	".~lock.*#",    // LibreOffice lock files
	"*.tmp",        //
	"*.temp",       //
	"*.partial",    //
	"*.part",       // wget, curl and most download managers
	"*.crdownload", // Chrome
	"*.download",   // Safari
}

// Set is a compiled list of exclude patterns.
type Set struct {
	patterns []string
	res      []*regexp.Regexp
}

// New compiles a set of glob patterns.
//
// A pattern without a slash matches the file name anywhere in the tree, the way
// .gitignore behaves, so "*.tmp" catches "a/b/c.tmp". A pattern with a slash is
// matched against the whole relative path. "**" spans directory separators,
// "*" and "?" do not.
func New(patterns []string) (*Set, error) {
	s := &Set{patterns: append([]string(nil), patterns...)}
	for _, p := range patterns {
		re, err := compile(p)
		if err != nil {
			return nil, fmt.Errorf("exclude pattern %q: %w", p, err)
		}
		s.res = append(s.res, re)
	}
	return s, nil
}

// Patterns returns the patterns this set was built from, for reporting.
func (s *Set) Patterns() []string {
	if s == nil {
		return nil
	}
	return s.patterns
}

// Excluded reports whether a relative path is hidden from the job.
func (s *Set) Excluded(rel string) bool {
	if s == nil || len(s.res) == 0 {
		return false
	}
	base := rel
	if i := strings.LastIndex(rel, "/"); i >= 0 {
		base = rel[i+1:]
	}
	for i, re := range s.res {
		subject := base
		if strings.Contains(s.patterns[i], "/") {
			subject = rel
		}
		if re.MatchString(subject) {
			return true
		}
		// A pattern naming a directory hides everything under it, otherwise
		// excluding "cache" would leave "cache/a/b.txt" syncing merrily.
		if strings.HasPrefix(rel, s.patterns[i]+"/") {
			return true
		}
	}
	return false
}

// compile turns one glob into an anchored regular expression. Writing this out
// rather than using path.Match is what buys "**": path.Match has no way to say
// "across directory separators", and without it "build/**" cannot be expressed.
func compile(pattern string) (*regexp.Regexp, error) {
	var b strings.Builder
	b.WriteString("^")
	for i := 0; i < len(pattern); i++ {
		c := pattern[i]
		switch c {
		case '*':
			if i+1 < len(pattern) && pattern[i+1] == '*' {
				b.WriteString(".*")
				i++
				continue
			}
			b.WriteString("[^/]*")
		case '?':
			b.WriteString("[^/]")
		default:
			b.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	b.WriteString("$")
	return regexp.Compile(b.String())
}
