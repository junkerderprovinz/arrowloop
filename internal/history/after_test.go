package history_test

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

func TestAfterPagesThroughRunsInTheOrderTheyWereRecorded(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	base := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	for i, job := range []string{"Fotos", "Musik", "Fotos"} {
		at := base.Add(time.Duration(i) * time.Minute)
		if err := db.Record(ctx, history.Run{Job: job, Started: at, Finished: at.Add(time.Second), Copied: i}, nil); err != nil {
			t.Fatal(err)
		}
	}

	first, err := db.After(ctx, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 2 || first[0].Job != "Fotos" || first[1].Job != "Musik" || first[0].ID >= first[1].ID {
		t.Fatalf("the first page is %+v", first)
	}
	rest, err := db.After(ctx, first[1].ID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(rest) != 1 || rest[0].Copied != 2 || !rest[0].Finished.Equal(base.Add(2*time.Minute+time.Second)) {
		t.Fatalf("the second page is %+v", rest)
	}
	none, err := db.After(ctx, rest[0].ID, 2)
	if err != nil || len(none) != 0 {
		t.Fatalf("after the last run came %+v, %v", none, err)
	}
}
