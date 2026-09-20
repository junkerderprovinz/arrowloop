package volume

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withCandidates points the search at directories the test controls.
func withCandidates(t *testing.T, dirs ...string) {
	t.Helper()
	previous := Candidates
	Candidates = func() []string { return dirs }
	t.Cleanup(func() { Candidates = previous })
}

func TestAVolumeIsFoundAfterItMoves(t *testing.T) {
	first := t.TempDir()
	m, err := Mark(first, "Photo backup")
	if err != nil {
		t.Fatalf("mark: %v", err)
	}
	withCandidates(t, first)

	resolved, err := Resolve(Prefix + m.ID + "/holiday")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if resolved != filepath.Join(first, "holiday") {
		t.Fatalf("resolved to %q", resolved)
	}

	// The same disk under another letter or mount point.
	second := t.TempDir()
	if err := os.MkdirAll(filepath.Join(second, ".arrowloop"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(first, filepath.FromSlash(markerPath)))
	if err != nil {
		t.Fatalf("read the marker: %v", err)
	}
	if err := os.WriteFile(filepath.Join(second, filepath.FromSlash(markerPath)), body, 0o644); err != nil {
		t.Fatalf("write the marker: %v", err)
	}
	withCandidates(t, second)

	resolved, err = Resolve(Prefix + m.ID + "/holiday")
	if err != nil {
		t.Fatalf("the volume was not found after it moved: %v", err)
	}
	if resolved != filepath.Join(second, "holiday") {
		t.Fatalf("resolved to %q, which is where the drive used to be", resolved)
	}
}

// The engine postpones a job on a missing volume instead of failing it.
func TestAMissingVolumeIsItsOwnAnswer(t *testing.T) {
	withCandidates(t)
	_, err := Resolve(Prefix + "0123456789abcdef/anything")
	if err == nil {
		t.Fatal("an unattached volume resolved to something")
	}
	if !errors.Is(err, ErrNotAttached) {
		t.Fatalf("got %v, which the engine cannot tell apart from a real failure", err)
	}
}

func TestOrdinaryPathsPassThrough(t *testing.T) {
	for _, path := range []string{
		`D:\Photos`, "/mnt/user/Photos", "sftp:backup/photos", "s3:bucket/photos", "",
	} {
		got, err := Resolve(path)
		if err != nil {
			t.Errorf("%q was rejected: %v", path, err)
		}
		if got != path {
			t.Errorf("%q came back as %q", path, got)
		}
	}
}

func TestMarkingTwiceKeepsOneIdentity(t *testing.T) {
	dir := t.TempDir()
	first, err := Mark(dir, "Backup")
	if err != nil {
		t.Fatalf("mark: %v", err)
	}
	second, err := Mark(dir, "Backup")
	if err != nil {
		t.Fatalf("mark again: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("marking twice produced two identities: %s and %s", first.ID, second.ID)
	}

	// A new label is allowed to replace the old one; the identity is not.
	renamed, err := Mark(dir, "Photo archive")
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.ID != first.ID {
		t.Fatal("renaming a volume changed its identity, which would orphan every job pointing at it")
	}
	if renamed.Label != "Photo archive" {
		t.Fatalf("the label did not change: %q", renamed.Label)
	}
}

// A marker outside the reserved directory would be synced to the other side.
func TestTheMarkerLivesWhereTheScannerSkips(t *testing.T) {
	if !strings.HasPrefix(markerPath, ".arrowloop/") {
		t.Fatalf("the marker at %q is not under the reserved prefix and would be synced", markerPath)
	}
}

func TestALabelSurvivesTheDriveLeaving(t *testing.T) {
	dir := t.TempDir()
	SetRegistry(filepath.Join(t.TempDir(), "volumes.json"))
	t.Cleanup(func() { SetRegistry("") })

	m, err := Mark(dir, "Backup drive")
	if err != nil {
		t.Fatalf("mark: %v", err)
	}
	withCandidates(t, dir)

	if got := Describe(Prefix + m.ID + "/holiday"); got != "Backup drive/holiday" {
		t.Fatalf("described as %q while attached", got)
	}

	// Unplugged: only the register is left.
	withCandidates(t)
	if got := Describe(Prefix + m.ID + "/holiday"); got != "Backup drive/holiday" {
		t.Errorf("an unplugged drive described itself as %q, which names nothing anybody owns", got)
	}

	var found bool
	for _, k := range Remembered() {
		if k.ID != m.ID {
			continue
		}
		found = true
		if k.Attached {
			t.Error("an unplugged drive is listed as attached")
		}
		if k.Label != "Backup drive" {
			t.Errorf("remembered under the label %q", k.Label)
		}
	}
	if !found {
		t.Error("a drive that has been seen was forgotten the moment it was unplugged")
	}

	Forget(m.ID)
	if len(Remembered()) != 0 {
		t.Error("a forgotten volume is still remembered")
	}
}

func TestWithoutARegisterNothingBreaks(t *testing.T) {
	SetRegistry("")
	dir := t.TempDir()
	m, err := Mark(dir, "Backup drive")
	if err != nil {
		t.Fatalf("mark: %v", err)
	}
	withCandidates(t, dir)

	if _, err := Resolve(Prefix + m.ID); err != nil {
		t.Fatalf("resolving without a register failed: %v", err)
	}
	if got := Describe(Prefix + m.ID); got == "" {
		t.Error("describing without a register produced nothing at all")
	}
}

func TestAVolumeWithTheLegacyMarkerIsFound(t *testing.T) {
	mount := t.TempDir()
	const id = "0f1e2d3c4b5a69788796a5b4"
	if err := os.MkdirAll(filepath.Join(mount, filepath.Dir(filepath.FromSlash(legacyMarkerPath))), 0o755); err != nil {
		t.Fatalf("prepare the old marker directory: %v", err)
	}
	body := []byte(`{"id":"` + id + `","label":"Photo backup","since":"2026-09-01T00:00:00Z"}`)
	if err := os.WriteFile(filepath.Join(mount, filepath.FromSlash(legacyMarkerPath)), body, 0o644); err != nil {
		t.Fatalf("write the old marker: %v", err)
	}
	withCandidates(t, mount)

	v, err := Find(id)
	if err != nil {
		t.Fatalf("a drive that is plugged in came back as not attached: %v", err)
	}
	if v.Mount != mount || v.Label != "Photo backup" {
		t.Fatalf("found %+v, wanted the drive at %s labelled Photo backup", v, mount)
	}

	// Marking copies the identity to the current path and keeps the old file
	// for older builds.
	m, err := Mark(mount, "")
	if err != nil {
		t.Fatalf("mark: %v", err)
	}
	if m.ID != id {
		t.Fatalf("marking gave the drive a second identity %q, the first was %q", m.ID, id)
	}
	if _, err := os.Stat(filepath.Join(mount, filepath.FromSlash(markerPath))); err != nil {
		t.Fatalf("the identity was not adopted into the current path: %v", err)
	}
	if _, err := os.Stat(filepath.Join(mount, filepath.FromSlash(legacyMarkerPath))); err != nil {
		t.Fatalf("the old marker was removed, which strands an older build: %v", err)
	}
}

// Remembered lists attached volumes as well as the register, so an attached
// drive has to lose its marker to disappear from the list.
func TestForgettingAnAttachedVolumeRemovesIt(t *testing.T) {
	root := t.TempDir()
	SetRegistry(filepath.Join(root, "volumes.json"))
	t.Cleanup(func() { SetRegistry("") })

	mount := t.TempDir()
	withCandidates(t, mount)

	m, err := Mark(mount, "Testplatte")
	if err != nil {
		t.Fatalf("mark: %v", err)
	}
	if got := Remembered(); len(got) != 1 {
		t.Fatalf("expected one volume after marking, got %+v", got)
	}

	Forget(m.ID)

	if got := Remembered(); len(got) != 0 {
		t.Fatalf("the volume came back after being forgotten: %+v", got)
	}
	if _, err := os.Stat(filepath.Join(mount, filepath.FromSlash(markerPath))); !os.IsNotExist(err) {
		t.Errorf("the marker is still on the volume: %v", err)
	}
}
