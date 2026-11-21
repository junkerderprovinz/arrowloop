package history_test

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/failure"
	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// A run that failed over files left for later twice keeps their reasons as
// codes, so the run log and the latest run can say them in any language.
func TestARunLeftTwiceKeepsTheReasonsOfItsFiles(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	at := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	twice := &failure.Twice{
		Files: []failure.Left{{
			Path: "status.fifo",
			Code: "unsupported",
			Vars: map[string]string{"kind": "named pipe", "side": "left"},
			Text: "named pipe on the left side, which this engine does not carry",
		}},
		More: 2,
	}
	run := history.Run{
		Job: "x", Started: at, Finished: at,
		Err:   "left for later in two runs in a row: status.fifo (named pipe on the left side, which this engine does not carry); and 2 more",
		Twice: twice,
	}
	if err := db.Record(ctx, run, nil); err != nil {
		t.Fatalf("record: %v", err)
	}

	recent, err := db.Recent(ctx, "x", history.ShowAll, 1)
	if err != nil || len(recent) != 1 {
		t.Fatalf("recent: %v, %v", recent, err)
	}
	latest, err := db.Latest(ctx, at.Add(-time.Hour))
	if err != nil || len(latest) != 1 {
		t.Fatalf("latest: %v, %v", latest, err)
	}
	for name, read := range map[string]history.Run{"the run log": recent[0], "the latest run": latest[0].Run} {
		said, err := json.Marshal(read)
		if err != nil {
			t.Fatal(err)
		}
		var got struct{ Failure *failure.Failure }
		if err := json.Unmarshal(said, &got); err != nil {
			t.Fatal(err)
		}
		if got.Failure == nil || got.Failure.Code != failure.LeftTwice || !reflect.DeepEqual(got.Failure.Twice, twice) {
			t.Errorf("%s sends %s, want the failure with the files and their reasons", name, said)
		}
	}
}
