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

// A nil set is what a job without patterns has.
func TestNilSetExcludesNothing(t *testing.T) {
	var s *Set
	if s.Excluded("anything.txt") {
		t.Error("a nil set excluded a path")
	}
	if s.Patterns() != nil {
		t.Error("a nil set reported patterns")
	}
}

// The app's own defaults name system folders as "**/name/**", and on a drive
// root those folders sit at the top.
func TestALeadingDoubleStarAlsoMatchesTheTop(t *testing.T) {
	s, err := New([]string{"**/System Volume Information/**", "docs/**/draft.txt"})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	for _, path := range []string{
		"System Volume Information/tracking.log",
		"D/System Volume Information/tracking.log",
		"docs/draft.txt",
		"docs/a/b/draft.txt",
	} {
		if !s.Excluded(path) {
			t.Errorf("%q should be excluded", path)
		}
	}
	if s.Excluded("System Volume Information") {
		t.Error("the folder itself was excluded, only what is inside it is")
	}
}

func TestExcludesTree(t *testing.T) {
	s, err := New([]string{"**/node_modules/**", "cache", "build/*", "*.tmp", "logs/**.log"})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	whole := []string{"node_modules", "web/node_modules", "cache", "cache/sub"}
	for _, dir := range whole {
		if !s.ExcludesTree(dir) {
			t.Errorf("everything below %q is excluded, so it need not be opened", dir)
		}
	}
	// Each of these still holds a path the job sees.
	partly := []string{"build", "scratch.tmp", "logs", "web", "node_modules_old", "cached"}
	for _, dir := range partly {
		if s.ExcludesTree(dir) {
			t.Errorf("%q holds files the job syncs and must be opened", dir)
		}
	}
	var none *Set
	if none.ExcludesTree("anything") {
		t.Error("a nil set excluded a folder")
	}
}
