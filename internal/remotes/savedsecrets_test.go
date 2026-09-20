package remotes

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
	"github.com/rclone/rclone/fs/config/obscure"
)

// saved writes one target into a config of this test's own.
func saved(t *testing.T, name, backend string, settings map[string]string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "rclone.conf")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	if err := config.SetConfigPath(path); err != nil {
		t.Fatalf("point at the config: %v", err)
	}
	configfile.Install()
	if err := Save(name, backend, settings); err != nil {
		t.Fatalf("save %s: %v", name, err)
	}
}

// A secret is withheld on its way to the screen, so a form editing a saved
// target sends no password, and checking it must use the saved one.
func TestAnAbsentSecretComesFromTheSavedTarget(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{
		"url":  "https://example.invalid/remote.php/webdav",
		"user": "someone",
		"pass": "letmein",
	})

	// What the form sends while editing: empty values are pruned.
	got := WithSavedSecrets("cloud", map[string]string{
		"url":  "https://example.invalid/remote.php/webdav",
		"user": "someone",
	})

	back, err := obscure.Reveal(got["pass"])
	if err != nil || back != "letmein" {
		t.Fatalf("pass = %q (reveal %q, %v), want the saved password", got["pass"], back, err)
	}
}

// The desktop fills the box with the placeholder rather than leaving it blank.
func TestThePlaceholderMeansTheSavedSecretToo(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "letmein"})

	got := WithSavedSecrets("cloud", map[string]string{"url": "https://example.invalid/", "pass": Placeholder})
	if got["pass"] == Placeholder {
		t.Fatal("the placeholder was sent on as the password")
	}
	if back, err := obscure.Reveal(got["pass"]); err != nil || back != "letmein" {
		t.Fatalf("pass revealed to %q, %v; want the saved password", back, err)
	}
}

// Somebody changing a credential checks whether the new one works.
func TestATypedSecretIsNotOverwritten(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "letmein"})

	got := WithSavedSecrets("cloud", map[string]string{"url": "https://example.invalid/", "pass": "the-new-one"})
	if got["pass"] != "the-new-one" {
		t.Fatalf("pass = %q, want the one that was typed", got["pass"])
	}
}

// A visible field somebody cleared stays cleared, as the screen shows it.
func TestAVisibleFieldIsNeverFilledIn(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{
		"url":  "https://example.invalid/",
		"user": "someone",
		"pass": "letmein",
	})

	got := WithSavedSecrets("cloud", map[string]string{"url": "https://example.invalid/", "user": ""})
	if got["user"] != "" {
		t.Fatalf("user = %q, want the empty value the form sent", got["user"])
	}
}

// A target being created has nothing to fill in from.
func TestAnUnsavedTargetPassesStraightThrough(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "letmein"})

	for _, name := range []string{"", "   ", "not-a-target"} {
		in := map[string]string{"url": "https://example.invalid/"}
		got := WithSavedSecrets(name, in)
		if _, filled := got["pass"]; filled {
			t.Errorf("%q invented a password", name)
		}
	}
}

// The caller's map is a decoded request body that other code reads afterwards.
func TestTheCallersMapIsLeftAlone(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "letmein"})

	in := map[string]string{"url": "https://example.invalid/"}
	_ = WithSavedSecrets("cloud", in)
	if _, grew := in["pass"]; grew {
		t.Fatal("the map that was passed in gained a password")
	}
}
