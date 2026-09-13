package remotes

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rclone/rclone/fs/config"
)

// THE DATA-LOSS BUG THIS FILE EXISTS FOR.
//
// rclone's default configuration path is under $HOME, which inside a container
// is part of the container's own filesystem and not part of the volume anybody
// mounts. So every storage target this program saved was destroyed by the next
// container update: not corrupted, not reported, simply gone, with the jobs that
// pointed at them left naming something that no longer answers.
//
// The targets must land beside the engine's own configuration, because that is
// the directory a person mounts precisely because they want it to survive.
func TestTheTargetsLiveBesideTheEnginesOwnConfig(t *testing.T) {
	restore := keepConfigPath(t)
	defer restore()

	dir := t.TempDir()
	beside := filepath.Join(dir, "arrowloop.json")

	if err := Use(beside); err != nil {
		t.Fatalf("Use: %v", err)
	}
	want := filepath.Join(dir, "rclone.conf")
	if got := config.GetConfigPath(); got != want {
		t.Fatalf("targets would be kept at %q, want %q", got, want)
	}
}

// An existing rclone.conf at the default is ADOPTED once, so a desktop install
// that has been using rclone for years does not read this change as "all your
// targets are gone".
func TestAnExistingConfigIsAdoptedOnce(t *testing.T) {
	restore := keepConfigPath(t)
	defer restore()

	old := filepath.Join(t.TempDir(), "rclone.conf")
	const content = "[mine]\ntype = webdav\n"
	if err := os.WriteFile(old, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := config.SetConfigPath(old); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	if err := Use(filepath.Join(dir, "arrowloop.json")); err != nil {
		t.Fatalf("Use: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(dir, "rclone.conf"))
	if err != nil {
		t.Fatalf("nothing was adopted: %v", err)
	}
	if string(got) != content {
		t.Fatalf("adopted %q, want %q", got, content)
	}
}

// Adoption happens ONCE. A second start must not overwrite what this program has
// been keeping since, or every restart would restore an old set of targets over
// the current one.
func TestAdoptionDoesNotOverwriteWhatIsAlreadyThere(t *testing.T) {
	restore := keepConfigPath(t)
	defer restore()

	old := filepath.Join(t.TempDir(), "rclone.conf")
	if err := os.WriteFile(old, []byte("[old]\ntype = webdav\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := config.SetConfigPath(old); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	ours := filepath.Join(dir, "rclone.conf")
	const current = "[current]\ntype = s3\n"
	if err := os.WriteFile(ours, []byte(current), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := Use(filepath.Join(dir, "arrowloop.json")); err != nil {
		t.Fatalf("Use: %v", err)
	}
	got, err := os.ReadFile(ours)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != current {
		t.Fatalf("the current file was overwritten with %q", got)
	}
}

// RCLONE_CONFIG is rclone's own documented override, and somebody who set it
// meant it.
func TestRcloneConfigEnvWins(t *testing.T) {
	restore := keepConfigPath(t)
	defer restore()

	t.Setenv("RCLONE_CONFIG", filepath.Join(t.TempDir(), "elsewhere.conf"))
	before := config.GetConfigPath()
	if err := Use(filepath.Join(t.TempDir(), "arrowloop.json")); err != nil {
		t.Fatalf("Use: %v", err)
	}
	if config.GetConfigPath() != before {
		t.Fatal("RCLONE_CONFIG was overridden")
	}
}

func keepConfigPath(t *testing.T) func() {
	t.Helper()
	previous := config.GetConfigPath()
	return func() { _ = config.SetConfigPath(previous) }
}
