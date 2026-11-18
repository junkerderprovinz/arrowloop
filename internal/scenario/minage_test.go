package scenario

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// age sets a file's modification time the given number of days back.
func age(t *testing.T, root, rel string, days int) {
	t.Helper()
	when := time.Now().Add(-time.Duration(days) * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(root, filepath.FromSlash(rel)), when, when); err != nil {
		t.Fatalf("chtimes %s: %v", rel, err)
	}
}

func onSide(root, rel string) bool {
	_, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel)))
	return err == nil
}

// A phone that moves its photos off keeps the recent ones until they reach
// the age the job waits for, and lets them go on the first run after that.
func TestMoveKeepsRecentPhotosUntilTheyAreOldEnough(t *testing.T) {
	j := moving(t)
	j.opt.Compare.MinAge = 30 * 24 * time.Hour
	write(t, j.left, "DCIM/old.jpg", "from last summer")
	write(t, j.left, "DCIM/new.jpg", "from yesterday")
	age(t, j.left, "DCIM/old.jpg", 200)
	age(t, j.left, "DCIM/new.jpg", 1)

	p, _ := j.run(t)
	if onSide(j.left, "DCIM/old.jpg") || !onSide(j.right, "DCIM/old.jpg") {
		t.Fatal("the old photo did not move")
	}
	if !onSide(j.left, "DCIM/new.jpg") || onSide(j.right, "DCIM/new.jpg") {
		t.Fatal("the recent photo left the phone")
	}
	if p.Young != 1 || len(p.Skipped) != 0 {
		t.Fatalf("young %d, skipped %+v; want one young file and no skips", p.Young, p.Skipped)
	}

	age(t, j.left, "DCIM/new.jpg", 31)
	j.run(t)
	if onSide(j.left, "DCIM/new.jpg") || readFile(t, j.right, "DCIM/new.jpg") != "from yesterday" {
		t.Fatal("the photo stayed on the phone after it was old enough")
	}
}

// A recent photo the archive already holds stays on the phone as well, and
// still leaves once it is old enough rather than being recorded as settled.
func TestMoveKeepsARecentPhotoTheArchiveAlreadyHolds(t *testing.T) {
	j := moving(t)
	j.opt.Compare.MinAge = 30 * 24 * time.Hour
	for _, side := range []string{j.left, j.right} {
		write(t, side, "DCIM/both.jpg", "already backed up")
		age(t, side, "DCIM/both.jpg", 2)
	}
	write(t, j.left, "DCIM/other.jpg", "keeps the side populated")

	j.run(t)
	if !onSide(j.left, "DCIM/both.jpg") {
		t.Fatal("a recent photo left the phone because the archive held it")
	}

	for _, side := range []string{j.left, j.right} {
		age(t, side, "DCIM/both.jpg", 40)
	}
	j.run(t)
	if onSide(j.left, "DCIM/both.jpg") {
		t.Fatal("the photo stayed on the phone after it was old enough")
	}
}
