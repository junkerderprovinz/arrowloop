package remotes

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
	"github.com/rclone/rclone/fs/config/obscure"
)

/*
Testing a saved target must use the credential it was saved with.

jdp, on a target that demonstrably works: "wenn ich beim opencloud konto auf
verbindung testen gehe kommt ein fehler." Nothing was wrong with the target. A
secret is withheld on its way to the screen, so the password box of a form
editing a saved target is EMPTY - and the form dutifully sent what it had, which
was no password at all. The engine then checked an anonymous connection and
reported, correctly, that it was refused.

Save had read an empty box as "keep the one that is there" since the beginning.
Check read it as "there is no password". Two readings of one form, and the
button that exists to tell you whether a target works said no about one that
works.

This is the test that would have caught it, and it is written against the
merge rather than against the whole check so it can say what happened without a
server to talk to.
*/

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

// THE BUG ITSELF: a form that sends no password gets the saved one.
func TestAnAbsentSecretComesFromTheSavedTarget(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{
		"url":  "https://example.invalid/remote.php/webdav",
		"user": "someone",
		"pass": "letmein",
	})

	// Exactly what the form sends while editing: every visible field, and no
	// `pass` at all, because the box was empty and empty values are pruned.
	got := WithSavedSecrets("cloud", map[string]string{
		"url":  "https://example.invalid/remote.php/webdav",
		"user": "someone",
	})

	back, err := obscure.Reveal(got["pass"])
	if err != nil || back != "letmein" {
		t.Fatalf("pass = %q (reveal %q, %v), want the saved password", got["pass"], back, err)
	}
}

// The placeholder is the other way the same box arrives - the desktop fills it
// with asterisks rather than leaving it blank - and it means the same thing.
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

/*
A TYPED PASSWORD WINS, which is the half that makes the button useful.

Somebody CHANGING a credential presses this to find out whether the new one
works. Filling in the old one over the top would test the wrong thing and pass,
and they would save a password that does not work and find out on the next run.
*/
func TestATypedSecretIsNotOverwritten(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "letmein"})

	got := WithSavedSecrets("cloud", map[string]string{"url": "https://example.invalid/", "pass": "the-new-one"})
	if got["pass"] != "the-new-one" {
		t.Fatalf("pass = %q, want the one that was typed", got["pass"])
	}
}

// Only secrets. A visible field somebody CLEARED stays cleared: they can see it
// is empty, so an engine that quietly put the old value back would be
// contradicting the screen.
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

// A target being CREATED has nothing to fill in from, and a name that does not
// exist must not be an error: the form asks the same way either way.
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

// The caller's map is not modified, because a function that quietly grows
// somebody else's map is a surprise waiting to happen - and this one is handed
// a decoded request body that other code reads afterwards.
func TestTheCallersMapIsLeftAlone(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "letmein"})

	in := map[string]string{"url": "https://example.invalid/"}
	_ = WithSavedSecrets("cloud", in)
	if _, grew := in["pass"]; grew {
		t.Fatal("the map that was passed in gained a password")
	}
}
