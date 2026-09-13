package remotes

import (
	"context"
	"strings"
	"testing"

	"github.com/rclone/rclone/fs/config"
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
func TestAValueWithASeparatorIsQuoted(t *testing.T) {
	got := connectionString("webdav", map[string]string{"pass": `a,b "c"`})
	want := `:webdav,pass="a,b ""c""":`
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
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
