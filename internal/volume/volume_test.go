package volume

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withCandidates points the search at a set of directories a test controls,
// instead of at whatever happens to be plugged into the machine running it.
func withCandidates(t *testing.T, dirs ...string) {
	t.Helper()
	previous := Candidates
	Candidates = func() []string { return dirs }
	t.Cleanup(func() { Candidates = previous })
}

// TestAVolumeIsFoundAfterItMoves is the whole point of the package. The same
// disk, mounted somewhere else, has to still be the same disk.
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

	// The drive comes back somewhere else, which on Windows is a different
	// letter and on Linux a different mount point. Everything about the path
	// changes except the disk.
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

// TestAMissingVolumeIsItsOwnAnswer covers the difference between "the disk is
// in somebody's bag" and "something is wrong". The engine treats the two
// completely differently, so they must not arrive as the same error.
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

// TestOrdinaryPathsPassThrough keeps the cost of this feature at zero for every
// job that does not use it.
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

// TestMarkingTwiceKeepsOneIdentity. Somebody who registers a disk they already
// registered should get the same answer, not a second volume shadowing the
// first, which would leave one job pointing at an identity nothing carries.
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

// TestTheMarkerLivesWhereTheScannerSkips. The marker sits inside the tree the
// engine syncs, so it has to be under the reserved prefix or it would travel to
// the other side and one disk's identity would end up on another.
func TestTheMarkerLivesWhereTheScannerSkips(t *testing.T) {
	if !strings.HasPrefix(markerPath, ".arrowloop/") {
		t.Fatalf("the marker at %q is not under the reserved prefix and would be synced", markerPath)
	}
}

// TestALabelSurvivesTheDriveLeaving. An identity is twenty-four characters of
// hex, which is the right thing to store and the wrong thing to show anybody.
// The label lives on the drive, so the one moment it cannot be read is the one
// moment somebody needs it: "Backup drive is not connected" can be acted on and
// a line of hex cannot.
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

	// Unplugged. The marker is now unreachable and only the register is left.
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

	// Forgetting is deliberate and complete.
	Forget(m.ID)
	if len(Remembered()) != 0 {
		t.Error("a forgotten volume is still remembered")
	}
}

// TestWithoutARegisterNothingBreaks. The register is a convenience, so every
// path through the package has to work without one.
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

// TestAVolumeMarkedBeforeTheRenameIsStillFound is the other half of the rename.
//
// A drive registered by an older build carries its identity under the old
// directory name. Losing sight of it does not fail in a way anybody can act on:
// the drive drops out of Attached, Find answers ErrNotAttached, and every job
// pointed at that volume is postponed with "not attached" while the disk sits
// plugged in and spinning.
func TestAVolumeMarkedBeforeTheRenameIsStillFound(t *testing.T) {
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

	// Marking it again moves the identity up to the current path, and leaves
	// the old file alone so an older build on another machine still works.
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

// TestForgettingAnAttachedVolumeActuallyForgetsIt.
//
// The defect this guards against answered 200 and changed nothing visible.
// Forget removed the register entry, and Remembered() builds its list from the
// register AND from whatever is attached right now - so a drive whose marker
// was still on it came straight back on the next listing, having been
// "forgotten" a moment earlier. jdp: "der button funktioniert auch noch nicht.
// ich kann die datentraeger nicht loeschen."
//
// The assertion is deliberately about REMEMBERED rather than about the marker
// file: what was broken is the thing somebody sees, and a test on the file
// alone would have passed while the row stayed on screen.
func TestForgettingAnAttachedVolumeActuallyForgetsIt(t *testing.T) {
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
		t.Fatalf("the volume came back after being forgotten, which is exactly what "+
			"the endpoint's 200 was hiding: %+v", got)
	}
	// And nothing of it is left on the disk, so plugging it in later does not
	// re-register a drive somebody deliberately removed.
	if _, err := os.Stat(filepath.Join(mount, filepath.FromSlash(markerPath))); !os.IsNotExist(err) {
		t.Errorf("the marker is still on the volume: %v", err)
	}
}
