package filter

import "testing"

func TestExcluded(t *testing.T) {
	cases := []struct {
		name     string
		patterns []string
		path     string
		want     bool
	}{
		{"no patterns lets everything through", nil, "a/b/c.txt", false},
		{"a bare name matches at any depth", []string{"*.tmp"}, "deep/inside/scratch.tmp", true},
		{"a bare name does not match a directory in the path", []string{"*.tmp"}, "scratch.tmp/real.txt", false},
		{"a pattern with a slash is anchored to the whole path", []string{"logs/*.log"}, "logs/today.log", true},
		{"and does not match the same name elsewhere", []string{"logs/*.log"}, "app/logs/today.log", false},
		{"double star crosses directories", []string{"**/node_modules/**"}, "web/x/node_modules/y/z.js", true},
		{"single star does not cross directories", []string{"build/*"}, "build/x/y.o", false},
		{"naming a directory hides what is inside it", []string{"cache"}, "cache/a/b.bin", true},
		{"question mark matches one character", []string{"log?.txt"}, "log1.txt", true},
		{"and not two", []string{"log?.txt"}, "log12.txt", false},
		{"a dot is literal, not any character", []string{"a.txt"}, "axtxt", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, err := New(tc.patterns)
			if err != nil {
				t.Fatalf("compile: %v", err)
			}
			if got := s.Excluded(tc.path); got != tc.want {
				t.Errorf("Excluded(%q) with %v = %v, want %v", tc.path, tc.patterns, got, tc.want)
			}
		})
	}
}

// TestInProgressCatchesTheUsualSuspects pins the default list to the names it
// exists for. Somebody trimming this list later should have to change a test
// that says out loud what each entry is protecting against.
func TestInProgressCatchesTheUsualSuspects(t *testing.T) {
	s, err := New(InProgress)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	busy := map[string]string{
		"~$quarterly.docx":      "Word owner file, exists only while the document is open",
		"docs/.~lock.notes#":    "LibreOffice lock file",
		"movie.mkv.part":        "a download still in flight",
		"iso/ubuntu.crdownload": "Chrome's half-finished download",
		"build/out.tmp":         "a program's scratch file",
	}
	for path, why := range busy {
		if !s.Excluded(path) {
			t.Errorf("%q should be excluded (%s)", path, why)
		}
	}
	real := []string{"quarterly.docx", "movie.mkv", "notes.txt", "partial-report.pdf", "temporary-notes.md"}
	for _, path := range real {
		if s.Excluded(path) {
			t.Errorf("%q is a real file and must still sync", path)
		}
	}
}

// A nil set is the common case when no patterns were given, and it must not
// panic on the hot path.
func TestNilSetExcludesNothing(t *testing.T) {
	var s *Set
	if s.Excluded("anything.txt") {
		t.Error("a nil set excluded a path")
	}
	if s.Patterns() != nil {
		t.Error("a nil set reported patterns")
	}
}
