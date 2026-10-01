package remotes

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rclone/rclone/fs/config"
)

// rclone's default path under $HOME is not on a container's mounted volume, so
// targets kept there vanish with the next update.
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

// Otherwise every restart would restore the old targets over the current ones.
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

func TestRcloneConfigEnvWins(t *testing.T) {
	restore := keepConfigPath(t)
	defer restore()

	elsewhere := filepath.Join(t.TempDir(), "elsewhere.conf")
	t.Setenv("RCLONE_CONFIG", elsewhere)
	if err := Use(filepath.Join(t.TempDir(), "arrowloop.json")); err != nil {
		t.Fatalf("Use: %v", err)
	}
	if got := config.GetConfigPath(); got != elsewhere {
		t.Fatalf("targets would be kept at %q, want %q from RCLONE_CONFIG", got, elsewhere)
	}
}

// keepConfigPath returns a function that points rclone back at the package's
// own file, never at whatever was set before, which could be the default path.
func keepConfigPath(t *testing.T) func() {
	t.Helper()
	return func() {
		if err := useRcloneConfig(testRcloneConf); err != nil {
			t.Error(err)
		}
	}
}
