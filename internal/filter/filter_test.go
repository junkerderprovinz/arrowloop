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

func TestBinnedCatchesAndroidsTrash(t *testing.T) {
	s, err := New(Binned)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	for _, path := range []string{".trashed-1792824403-IMG_0001.jpg", "DCIM/Camera/.trashed-1793114567-clip.mp4"} {
		if !s.Excluded(path) {
			t.Errorf("%q is in Android's bin and should be excluded", path)
		}
	}
	for _, path := range []string{"trashed-notes.txt", "DCIM/.trashed/readme.txt", "IMG_0001.jpg"} {
		if s.Excluded(path) {
			t.Errorf("%q is a real file and must still sync", path)
		}
	}
}

func TestInProgressCatchesTheUsualSuspects(t *testing.T) {
	s, err := New(InProgress)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	busy := map[string]string{
		"~$quarterly.docx":                       "Word owner file, exists only while the document is open",
		"docs/.~lock.notes#":                     "LibreOffice lock file",
		"movie.mkv.part":                         "a download still in flight",
		"iso/ubuntu.crdownload":                  "Chrome's half-finished download",
		"build/out.tmp":                          "a program's scratch file",
		"Download/.pending-1792824403-setup.apk": "a download Android has not finished",
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

// OneDrive names its Personal Vault in the account's language, and a pattern
// typed on one system may be composed differently from the name another
// system stores.
func TestAPatternWithAccentsMatchesItsName(t *testing.T) {
	composed := "Persönlicher Tresor"
	decomposed := "Persönlicher Tresor"
	for _, pattern := range []string{composed, decomposed} {
		s, err := New([]string{pattern + "/**"})
		if err != nil {
			t.Fatalf("compile: %v", err)
		}
		for _, name := range []string{composed, decomposed} {
			if !s.ExcludesTree(name) {
				t.Errorf("%q does not keep the walk out of %q", pattern, name)
			}
			if !s.Excluded(name + "/pass.pdf") {
				t.Errorf("%q does not exclude a file in %q", pattern, name)
			}
		}
	}
	s, err := New([]string{"*.été"})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if !s.Excluded("a/notes.été") {
		t.Error("a name pattern with accents does not match")
	}
}

func TestOnly(t *testing.T) {
	cases := []struct {
		name    string
		include []string
		exclude []string
		path    string
		want    bool
	}{
		{"a file matching an include pattern is kept", []string{"*.tar.gz"}, nil, "backups/2026/home.tar.gz", false},
		{"a file matching none is hidden", []string{"*.tar.gz"}, nil, "backups/2026/notes.txt", true},
		{"any one of the patterns is enough", []string{"*.c", "*.h"}, nil, "src/x.h", false},
		{"naming a directory keeps what is inside it", []string{"src"}, nil, "src/a/b.go", false},
		{"a pattern with a slash is anchored to the whole path", []string{"src/*.go"}, nil, "lib/src/x.go", true},
		{"an exclusion still wins over an inclusion", []string{"*.tar.gz"}, []string{"old/**"}, "old/home.tar.gz", true},
		{"no include patterns keep everything", nil, nil, "a/b.txt", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, err := New(tc.exclude)
			if err != nil {
				t.Fatalf("compile: %v", err)
			}
			if s, err = s.Only(tc.include); err != nil {
				t.Fatalf("compile: %v", err)
			}
			if got := s.Excluded(tc.path); got != tc.want {
				t.Errorf("Excluded(%q) with only %v = %v, want %v", tc.path, tc.include, got, tc.want)
			}
		})
	}
}

func TestOnlyReportsWhetherItNarrows(t *testing.T) {
	s, _ := New(nil)
	if s.Narrows() {
		t.Error("a set without include patterns narrows")
	}
	if s, _ = s.Only([]string{"*.jpg"}); !s.Narrows() {
		t.Error("a set with include patterns does not narrow")
	}
}

// A listing has to open every folder, since a kept file may lie anywhere.
func TestOnlyPrunesNoFolder(t *testing.T) {
	s, _ := New(nil)
	s, _ = s.Only([]string{"*.jpg"})
	if s.ExcludesTree("Documents") {
		t.Error("a folder was pruned for not matching an include pattern")
	}
}

func TestOnlyExcludePatternsHideAFolder(t *testing.T) {
	s, _ := New([]string{"cache"})
	s, _ = s.Only([]string{"*.jpg"})
	if s.HidesFolder("DCIM") {
		t.Error("a folder was hidden for not matching an include pattern")
	}
	if !s.HidesFolder("cache") {
		t.Error("an excluded folder was not hidden")
	}
}

func TestNothingHidesEveryPathAndTree(t *testing.T) {
	s, err := New(nil)
	if err != nil {
		t.Fatal(err)
	}
	none := s.Nothing()
	for _, rel := range []string{"a.jpg", "deep/b.txt", "folder"} {
		if !none.Excluded(rel) {
			t.Errorf("%s is let through by a set that takes nothing", rel)
		}
	}
	if !none.ExcludesTree("DCIM") {
		t.Error("a set that takes nothing still opens folders")
	}
	if !none.Narrows() {
		t.Error("a set that takes nothing does not say it narrows the job")
	}
	if s.Excluded("a.jpg") {
		t.Error("Nothing changed the set it was called on")
	}
}
