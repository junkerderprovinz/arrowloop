// Package filter decides which paths a job is allowed to see at all.
//
// An excluded path has not been deleted. If it were only dropped from the
// listings, the engine would read a newly excluded file as a deletion and
// remove it on the other side, so the same exclusion is applied to the record
// and to both sides.
package filter

import (
	"fmt"
	"regexp"
	"strings"
)

// InProgress are the names programs use while they are still writing a file.
// They are excluded by default: they exist for seconds and mean nothing on
// another machine.
var InProgress = []string{
	"~$*",       // Microsoft Office owner files
	".~lock.*#", // LibreOffice lock files
	"*.tmp",
	"*.temp",
	"*.partial",
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
		// A pattern naming a directory hides everything under it.
		if strings.HasPrefix(rel, s.patterns[i]+"/") {
			return true
		}
	}
	return false
}

// compile turns one glob into an anchored regular expression. path.Match has
// no pattern that spans directory separators, so it cannot express "**".
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
