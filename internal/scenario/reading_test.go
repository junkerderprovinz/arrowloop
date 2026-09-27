package scenario

import (
	"context"
	"fmt"
	"reflect"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

func TestReadingReportsEveryStageBeforeTheFirstFileMoves(t *testing.T) {
	j := newJob(t, quick())
	for i := range 3 {
		write(t, j.left, fmt.Sprintf("album/%d.flac", i), "tune")
	}
	j.sync(t)
	write(t, j.right, "album/3.flac", "new tune")

	var got []scan.Reading
	ctx := scan.WithWatch(context.Background(), func(r scan.Reading) { got = append(got, r) })
	if _, _, err := engine.Once(ctx, j.ends, j.db, j.opt); err != nil {
		t.Fatalf("sync: %v", err)
	}

	// The last report of each stage, in the order the stages began.
	var order []string
	last := map[string]scan.Reading{}
	for _, r := range got {
		name := string(r.Stage) + " " + r.Side
		if _, seen := last[name]; !seen {
			order = append(order, name)
		}
		last[name] = r
	}
	want := []string{"list left", "check left", "list right", "check right", "compare "}
	if !reflect.DeepEqual(order, want) {
		t.Fatalf("stages ran as %q, want %q", order, want)
	}

	// A listing measures itself against the record, which knows three files.
	if r := last["list left"]; r.Done != 3 || r.Total != 3 || !r.Guess {
		t.Errorf("left listing ended at %+v, want 3 of a guessed 3", r)
	}
	if r := last["list right"]; r.Done != 4 || r.Total != 3 || !r.Guess {
		t.Errorf("right listing ended at %+v, want 4 of a guessed 3", r)
	}
	// The second walk knows what the listing found.
	if r := last["check right"]; r.Done != 4 || r.Total != 4 || r.Guess {
		t.Errorf("right check ended at %+v, want 4 of a known 4", r)
	}
	if r := last["compare "]; r.Total != 4 || r.Done != 3 {
		t.Errorf("comparison ended at %+v, want the fourth of 4 paths", r)
	}
}

func TestAFirstRunMeasuresTheRightSideAgainstTheLeft(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "a.txt", "a")
	write(t, j.left, "b.txt", "b")

	var first, right *scan.Reading
	ctx := scan.WithWatch(context.Background(), func(r scan.Reading) {
		if r.Stage != scan.StageList {
			return
		}
		if r.Side == "left" && first == nil {
			first = &r
		}
		if r.Side == "right" {
			right = &r
		}
	})
	if _, _, err := engine.Once(ctx, j.ends, j.db, j.opt); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if first == nil || first.Total != 0 {
		t.Errorf("left listing started at %+v, want no total on a first run", first)
	}
	if right == nil || right.Total != 2 {
		t.Errorf("right listing ended at %+v, want a total of 2 from the left", right)
	}
}
