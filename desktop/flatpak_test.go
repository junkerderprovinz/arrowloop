package main

import (
	"context"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
)

const flatpakID = "io.github.junkerderprovinz.arrowloop"

// The sandbox lets the app own bus names under its own ID alone, and the
// desktop finds the app's launcher for a window by the same name.
func TestAFlatpakGoesByItsID(t *testing.T) {
	t.Setenv("FLATPAK_ID", flatpakID)
	opts := linuxOptions()
	if opts.ApplicationID != flatpakID || opts.ProgramName != flatpakID {
		t.Errorf("application ID %q, program name %q, want both %q", opts.ApplicationID, opts.ProgramName, flatpakID)
	}
	if !opts.DisableQuitOnLastWindowClosed {
		t.Error("closing the main window would end the program while the tray still shows it")
	}
	if got := instanceID("", "/home/jane/.var/app/"+flatpakID+"/config/ArrowLoop/arrowloop.json"); got != flatpakID {
		t.Errorf("single-instance lock %q, want %q", got, flatpakID)
	}
}

func TestOutsideAFlatpakTheNamesStay(t *testing.T) {
	t.Setenv("FLATPAK_ID", "")
	opts := linuxOptions()
	if opts.ApplicationID != "" || opts.ProgramName != "ArrowLoop" {
		t.Errorf("application ID %q, program name %q", opts.ApplicationID, opts.ProgramName)
	}
}

func TestAFlatpakNeverUpdatesItself(t *testing.T) {
	t.Setenv("FLATPAK_ID", flatpakID)
	asked := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case asked <- struct{}{}:
		default:
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	api, first, version := updateAPI, firstCheck, boot.Version
	updateAPI, firstCheck, boot.Version = srv.URL, 0, "v2.5.0"
	t.Cleanup(func() { updateAPI, firstCheck, boot.Version = api, first, version })

	up := newUpdater(deskset.Open(filepath.Join(t.TempDir(), "arrowloop.json")), log.New(io.Discard, "", 0), func(string) {})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		up.run(ctx)
		close(done)
	}()

	select {
	case <-done:
	case <-asked:
		t.Fatal("a Flatpak looked for a release to replace itself with")
	case <-time.After(5 * time.Second):
		t.Fatal("a Flatpak keeps waiting to update itself")
	}
}
