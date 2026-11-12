package history_test

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

func TestOpeningsPageInTheOrderTheyCameAndAgeOutWithTheRuns(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	base := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	for i, app := range []string{"BombVault", "KnightLoader", "BombVault"} {
		o := history.Opening{At: base.Add(time.Duration(i) * time.Hour), App: app, Device: "Tower", Member: "member-" + app}
		if err := db.RecordOpening(ctx, o); err != nil {
			t.Fatal(err)
		}
	}

	first, err := db.OpeningsAfter(ctx, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 2 || first[0].App != "BombVault" || first[1].App != "KnightLoader" || first[0].ID >= first[1].ID {
		t.Fatalf("the first page is %+v", first)
	}
	if first[1].Device != "Tower" || first[1].Member != "member-KnightLoader" || !first[1].At.Equal(base.Add(time.Hour)) {
		t.Errorf("the second opening reads %+v", first[1])
	}
	rest, err := db.OpeningsAfter(ctx, first[1].ID, 2)
	if err != nil || len(rest) != 1 {
		t.Fatalf("the second page is %+v, %v", rest, err)
	}

	if _, err := db.Prune(ctx, 90*time.Minute, base.Add(3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	kept, err := db.OpeningsAfter(ctx, 0, 10)
	if err != nil || len(kept) != 1 || kept[0].ID != rest[0].ID {
		t.Errorf("after pruning %+v is left, %v", kept, err)
	}
}
