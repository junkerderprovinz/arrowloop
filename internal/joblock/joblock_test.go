package joblock

import (
	"path/filepath"
	"testing"
)

func TestASecondHolderFindsTheJobHeld(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")

	release, held, err := Take(dir, "a1b2c3d4e5f6")
	if err != nil || held {
		t.Fatalf("first Take: held %v, err %v", held, err)
	}
	defer release()

	again, held, err := Take(dir, "a1b2c3d4e5f6")
	if err != nil {
		t.Fatal(err)
	}
	if !held {
		again()
		t.Fatal("a second Take on the same job got the lock")
	}
}

func TestAReleasedJobCanBeTakenAgain(t *testing.T) {
	dir := t.TempDir()

	release, _, err := Take(dir, "a1b2c3d4e5f6")
	if err != nil {
		t.Fatal(err)
	}
	release()

	again, held, err := Take(dir, "a1b2c3d4e5f6")
	if err != nil || held {
		t.Fatalf("Take after release: held %v, err %v", held, err)
	}
	again()
}

func TestOtherJobsAreIndependent(t *testing.T) {
	dir := t.TempDir()
	first, _, err := Take(dir, "a1b2c3d4e5f6")
	if err != nil {
		t.Fatal(err)
	}
	defer first()

	second, held, err := Take(dir, "0f1e2d3c4b5a")
	if err != nil || held {
		t.Fatalf("another job: held %v, err %v", held, err)
	}
	second()
}
