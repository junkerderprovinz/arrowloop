package releasenotes

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const source = "../../.github/release-notes"

func versions(notes []Note) []string {
	out := make([]string, len(notes))
	for i, n := range notes {
		out[i] = n.Version
	}
	return out
}

func TestAReleaseGetsItsOwnNotesAndTheOlderOnesNewestFirst(t *testing.T) {
	got := versions(UpTo("v1.2.1"))
	want := []string{"v1.2.1", "v1.2.0", "v1.1.0", "v1.0.0"}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("UpTo(v1.2.1) = %v, want %v", got, want)
	}
}

func TestABuildPastAReleaseStopsAtThatRelease(t *testing.T) {
	got := UpTo("v1.2.0-7-g59b73a6")
	if len(got) == 0 || got[0].Version != "v1.2.0" {
		t.Fatalf("UpTo(v1.2.0-7-g59b73a6) starts with %v, want v1.2.0", versions(got))
	}
	if got[0].Body == "" || strings.HasSuffix(got[0].Body, "\n") {
		t.Errorf("the body of v1.2.0 is %q, want the trimmed notes", got[0].Body)
	}
}

func TestADevBuildGetsEveryRelease(t *testing.T) {
	entries, err := os.ReadDir("notes")
	if err != nil {
		t.Fatal(err)
	}
	if got := UpTo("dev"); len(got) != len(entries) {
		t.Errorf("UpTo(dev) has %d notes, want all %d", len(got), len(entries))
	}
}

// After adding a release note, copy it here:
// cp .github/release-notes/*.md internal/releasenotes/notes/
func TestEveryReleaseNoteIsCarried(t *testing.T) {
	entries, err := os.ReadDir(source)
	if err != nil {
		t.Skipf("no release notes beside the package (%v)", err)
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		want, err := os.ReadFile(filepath.Join(source, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		got, err := notesFS.ReadFile("notes/" + e.Name())
		if err != nil {
			t.Errorf("%s is not in internal/releasenotes/notes; copy it there", e.Name())
			continue
		}
		if strings.TrimSpace(string(want)) != strings.TrimSpace(string(got)) {
			t.Errorf("notes/%s differs from .github/release-notes/%s; copy it again", e.Name(), e.Name())
		}
	}
}

// A note left behind after its source went would show a release that never
// happened.
func TestEveryCarriedNoteHasASource(t *testing.T) {
	if _, err := os.Stat(source); err != nil {
		t.Skipf("no release notes beside the package (%v)", err)
	}
	entries, err := notesFS.ReadDir("notes")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if _, err := os.Stat(filepath.Join(source, e.Name())); err != nil {
			t.Errorf("notes/%s has no .github/release-notes/%s; delete it", e.Name(), e.Name())
		}
	}
}
