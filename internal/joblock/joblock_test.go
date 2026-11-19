package joblock

import (
	"path/filepath"
	"testing"
)

func TestASecondHolderFindsTheJobHeld(t *testing.T) {
	state := filepath.Join(t.TempDir(), "state", "photos.db")

	release, held, err := Take(state)
	if err != nil || held {
		t.Fatalf("first Take: held %v, err %v", held, err)
	}
	defer release()

	again, held, err := Take(state)
	if err != nil {
		t.Fatal(err)
	}
	if !held {
		again()
		t.Fatal("a second Take on the same job got the lock")
	}
}

func TestAReleasedJobCanBeTakenAgain(t *testing.T) {
	state := filepath.Join(t.TempDir(), "photos.db")

	release, _, err := Take(state)
	if err != nil {
		t.Fatal(err)
	}
	release()

	again, held, err := Take(state)
	if err != nil || held {
		t.Fatalf("Take after release: held %v, err %v", held, err)
	}
	again()
}

func TestJobsWithOtherStateAreIndependent(t *testing.T) {
	dir := t.TempDir()
	first, _, err := Take(filepath.Join(dir, "photos.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer first()

	second, held, err := Take(filepath.Join(dir, "music.db"))
	if err != nil || held {
		t.Fatalf("another job: held %v, err %v", held, err)
	}
	second()
}
