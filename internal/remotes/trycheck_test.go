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
	want := `:s3,endpoint=http://192.168.20.76:3900,provider=Minio:`
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// A secret with a comma in it would end the option early and silently produce a
// different target, which reads as a wrong password rather than a parsing bug.
// Checked on a field rclone does NOT reveal, so the quoting is visible.
func TestAValueWithASeparatorIsQuoted(t *testing.T) {
	got := connectionString("s3", map[string]string{"endpoint": `a,b "c"`})
	want := `:s3,endpoint="a,b ""c""":`
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// WebDAV's password must arrive OBSCURED, because rclone reveals it wherever it
// reads it and a connection string is read like a config file. Measured against
// a live engine, which answered "input too short when revealing password".
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

// A secret that came back from the screen UNTOUCHED is already obscured, and
// obscuring it twice would produce a password nobody typed.
func TestAnAlreadyObscuredSecretIsLeftAlone(t *testing.T) {
	hidden, err := obscure.Obscure("demo")
	if err != nil {
		t.Fatal(err)
	}
	got := connectionString("webdav", map[string]string{"pass": hidden})
	inside := got[len(":webdav,pass=") : len(got)-1]
	back, err := obscure.Reveal(inside)
	if err != nil || back != "demo" {
		t.Fatalf("reveal(%q) = %q, %v; want demo", inside, back, err)
	}
}

// THE PROPERTY THAT MAKES THIS SAFE: nothing is written. The obvious way to
// check unsaved settings is to save them under a temporary name, and a crash
// between that and the delete leaves real credentials in the config file under a
// name nobody recognises.
func TestCheckingUnsavedSettingsWritesNothing(t *testing.T) {
	before := config.LoadedData().GetSectionList()

	// TEST-NET-1 (RFC 5737) is reserved for documentation, so nothing anywhere
	// answers it and this cannot wander onto a real server.
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
