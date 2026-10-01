package remotes

import (
	"context"
	"strings"
	"testing"

	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/obscure"
)

func TestAConnectionStringCarriesEverySetting(t *testing.T) {
	got := connectionString("s3", map[string]string{
		"provider": "Minio",
		"endpoint": "http://192.168.20.76:3900",
		"type":     "s3", // never repeated: it is already the backend
		"region":   "",   // empty settings are absent, not empty
	})
	// The endpoint is quoted, because a colon ends a connection string.
	want := `:s3,endpoint="http://192.168.20.76:3900",provider=Minio:`
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// Checked on a field rclone does not reveal, so the quoting is visible.
func TestAValueWithASeparatorIsQuoted(t *testing.T) {
	got := connectionString("s3", map[string]string{"endpoint": `a,b "c"`})
	want := `:s3,endpoint="a,b ""c""":`
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// rclone reveals WebDAV's password in a connection string as it does in the
// config file.
func TestAPasswordIsObscuredForTheConnection(t *testing.T) {
	got := connectionString("webdav", map[string]string{"pass": "demo"})
	if strings.Contains(got, "pass=demo") {
		t.Fatalf("the password went verbatim: %s", got)
	}
	inside := got[len(":webdav,pass=") : len(got)-1]
	back, err := obscure.Reveal(inside)
	if err != nil || back != "demo" {
		t.Fatalf("reveal(%q) = %q, %v; want demo", inside, back, err)
	}
}

// A long alphanumeric password decodes as base64, which is all rclone asks of
// an obscured value, so it looks obscured without being so.
func TestATypedPasswordThatLooksObscuredIsStillObscured(t *testing.T) {
	const typed = "Sommer2026Sommer2026Abc"
	if _, err := obscure.Reveal(typed); err != nil {
		t.Fatalf("the example no longer decodes, so it shows nothing: %v", err)
	}
	got := connectionString("webdav", map[string]string{"pass": typed})
	inside := got[len(":webdav,pass=") : len(got)-1]
	if back, err := obscure.Reveal(inside); err != nil || back != typed {
		t.Fatalf("rclone would log in with %q (%v), not the password typed", back, err)
	}
}

// A saved password stands in for one the form never received, and has to
// reach rclone as the password that was saved.
func TestASavedPasswordReachesTheConnectionAsSaved(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "letmein"})

	got := connectionString("webdav", WithSavedSecrets("cloud", map[string]string{"pass": Placeholder}))
	inside := got[len(":webdav,pass=") : len(got)-1]
	if back, err := obscure.Reveal(inside); err != nil || back != "letmein" {
		t.Fatalf("rclone would log in with %q (%v), not the saved password", back, err)
	}
}

func TestAUrlSurvivesTheConnectionString(t *testing.T) {
	const url = "http://192.168.20.77:9200/remote.php/webdav/"
	got := connectionString("webdav", map[string]string{"url": url})
	want := `:webdav,url="http://192.168.20.77:9200/remote.php/webdav/":`
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// Anything outside letters, digits and -._~ is quoted.
func TestAnythingUnusualIsQuoted(t *testing.T) {
	for _, value := range []string{"a:b", "a/b", "a=b", "a b", "a,b", "a	b", "a\"b"} {
		got := connectionString("webdav", map[string]string{"x": value})
		if !strings.Contains(got, `x="`) {
			t.Errorf("%q went bare: %s", value, got)
		}
	}
}

func TestAPlainValueStaysBare(t *testing.T) {
	got := connectionString("s3", map[string]string{"region": "eu-central-1"})
	if got != ":s3,region=eu-central-1:" {
		t.Fatalf("got %q", got)
	}
}

func TestCheckingUnsavedSettingsWritesNothing(t *testing.T) {
	ownConfig(t)
	before := config.LoadedData().GetSectionList()

	// TEST-NET-1 (RFC 5737) is reserved for documentation, so nothing answers
	// it.
	_ = CheckSettings(context.Background(), "webdav", map[string]string{
		"url":  "http://192.0.2.1:9999/",
		"user": "nobody",
		"pass": "nothing",
	})

	after := config.LoadedData().GetSectionList()
	if len(after) != len(before) {
		t.Fatalf("the config grew from %d sections to %d: something was saved", len(before), len(after))
	}
}

func TestAnUnknownBackendIsRefusedBeforeAnythingElse(t *testing.T) {
	err := CheckSettings(context.Background(), "not-a-backend", nil)
	if err == nil || !strings.Contains(err.Error(), "does not include") {
		t.Fatalf("err = %v, want it to name the missing backend", err)
	}
}

func TestAMissingBackendIsRefused(t *testing.T) {
	if err := CheckSettings(context.Background(), "", nil); err == nil {
		t.Fatal("a target with no type was accepted")
	}
}
