package history_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	// The clock change test needs Europe/Berlin on machines without a zone
	// database.
	_ "time/tzdata"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// record puts one run in the log, with the counts the test cares about.
func record(t *testing.T, db *history.DB, job string, at time.Time, r history.Run) {
	t.Helper()
	r.Job, r.Started, r.Finished = job, at, at
	if err := db.Record(context.Background(), r, nil); err != nil {
		t.Fatalf("record: %v", err)
	}
}

// rowFor finds the bar for one day, or fails saying which days there were.
func rowFor(t *testing.T, s history.Stats, day, job string) history.DailyStat {
	t.Helper()
	for _, row := range s.Rows {
		if row.Day == day && row.Job == job {
			return row
		}
	}
	var had []string
	for _, row := range s.Rows {
		had = append(had, row.Day+"/"+row.Job)
	}
	t.Fatalf("no row for %s/%q; the answer holds %v", day, job, had)
	return history.DailyStat{}
}

// The quiet days have to be there and the busy days have to keep their numbers.
func TestEveryDayInTheWindowComesBackIncludingTheQuietOnes(t *testing.T) {
	db := openTemp(t)
	now := time.Date(2027, 3, 10, 12, 0, 0, 0, time.UTC)

	record(t, db, "photos", now.AddDate(0, 0, -4), history.Run{Copied: 7})
	record(t, db, "photos", now, history.Run{Copied: 2})

	got, err := db.Summary(t.Context(), history.StatsQuery{Days: 5, Now: now, In: time.UTC})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if len(got.Rows) != 5 {
		t.Fatalf("a five day window came back with %d rows, so the quiet days are missing", len(got.Rows))
	}

	want := []string{"2027-03-06", "2027-03-07", "2027-03-08", "2027-03-09", "2027-03-10"}
	for i, day := range want {
		if got.Rows[i].Day != day {
			t.Fatalf("row %d is %s, expected %s: the days are not in order", i, got.Rows[i].Day, day)
		}
	}
	if got.From != want[0] || got.To != want[len(want)-1] {
		t.Errorf("the answer says the window is %s..%s, expected %s..%s", got.From, got.To, want[0], want[len(want)-1])
	}
	if n := rowFor(t, got, "2027-03-06", "").Copied; n != 7 {
		t.Errorf("the busy day at the start of the window reports %d copied, expected 7", n)
	}
	if n := rowFor(t, got, "2027-03-10", "").Copied; n != 2 {
		t.Errorf("today reports %d copied, expected 2", n)
	}
	for _, quiet := range []string{"2027-03-07", "2027-03-08", "2027-03-09"} {
		row := rowFor(t, got, quiet, "")
		if row.Runs != 0 || row.Copied != 0 {
			t.Errorf("%s should be an empty day and reports %+v", quiet, row)
		}
	}
}

// The two cases move the day in opposite directions from UTC, so grouping in
// UTC cannot pass both.
func TestTheDayIsCutInTheCallersZoneAndNotInUTC(t *testing.T) {
	east := time.FixedZone("Kiritimati", 14*3600)
	west := time.FixedZone("Baker", -12*3600)

	for _, c := range []struct {
		name    string
		zone    *time.Location
		ran     time.Time
		wantDay string
		utcDay  string
	}{
		// 11:00 UTC on the first is already 01:00 on the second out east.
		{"east of Greenwich", east, time.Date(2027, 3, 1, 11, 0, 0, 0, time.UTC), "2027-03-02", "2027-03-01"},
		// 11:00 UTC on the second is still 23:00 on the first out west.
		{"west of Greenwich", west, time.Date(2027, 3, 2, 11, 0, 0, 0, time.UTC), "2027-03-01", "2027-03-02"},
	} {
		t.Run(c.name, func(t *testing.T) {
			db := openTemp(t)
			record(t, db, "photos", c.ran, history.Run{Copied: 3})

			now := time.Date(2027, 3, 2, 12, 0, 0, 0, c.zone)
			got, err := db.Summary(t.Context(), history.StatsQuery{Days: 3, Now: now, In: c.zone})
			if err != nil {
				t.Fatalf("summary: %v", err)
			}
			if n := rowFor(t, got, c.wantDay, "").Copied; n != 3 {
				t.Errorf("the run is not on %s, which is the day the clock on that machine showed", c.wantDay)
			}
			if n := rowFor(t, got, c.utcDay, "").Copied; n != 0 {
				t.Errorf("the run landed on %s, which is its day in UTC and not the day anybody there lived through", c.utcDay)
			}
		})
	}
}

// The last Sunday in March is 23 hours long in Berlin, so stepping back 24 hours
// at a time would produce the 27th twice and drop the 28th. The runs on either
// side of the change catch an offset worked out once for the whole window.
func TestAWindowAcrossAClockChangeKeepsItsDaysStraight(t *testing.T) {
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Fatalf("load Europe/Berlin: %v", err)
	}
	db := openTemp(t)

	record(t, db, "photos", time.Date(2027, 3, 27, 23, 30, 0, 0, berlin), history.Run{Copied: 1})
	record(t, db, "photos", time.Date(2027, 3, 28, 12, 0, 0, 0, berlin), history.Run{Copied: 2})
	record(t, db, "photos", time.Date(2027, 3, 29, 0, 30, 0, 0, berlin), history.Run{Copied: 4})

	now := time.Date(2027, 3, 30, 12, 0, 0, 0, berlin)
	got, err := db.Summary(t.Context(), history.StatsQuery{Days: 5, Now: now, In: berlin})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}

	want := []string{"2027-03-26", "2027-03-27", "2027-03-28", "2027-03-29", "2027-03-30"}
	if len(got.Rows) != len(want) {
		t.Fatalf("a five day window across the clock change came back with %d rows", len(got.Rows))
	}
	for i, day := range want {
		if got.Rows[i].Day != day {
			t.Fatalf("row %d is %s and should be %s: the window slipped across the clock change", i, got.Rows[i].Day, day)
		}
	}
	for day, copied := range map[string]int{
		"2027-03-26": 0, "2027-03-27": 1, "2027-03-28": 2, "2027-03-29": 4, "2027-03-30": 0,
	} {
		if n := rowFor(t, got, day, "").Copied; n != copied {
			t.Errorf("%s reports %d copied, expected %d", day, n, copied)
		}
	}
}

func TestTheAnswerNamesTheZoneItCutIn(t *testing.T) {
	db := openTemp(t)
	zone := time.FixedZone("Kiritimati", 14*3600)
	now := time.Date(2027, 3, 2, 12, 0, 0, 0, zone)

	got, err := db.Summary(t.Context(), history.StatsQuery{Days: 3, Now: now, In: zone})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	want, _ := now.Zone()
	if got.Zone != want {
		t.Errorf("the answer says it cut the days in %q, and it cut them in %q", got.Zone, want)
	}
}

func TestTheWindowIsBoundedAndSaysSo(t *testing.T) {
	db := openTemp(t)
	now := time.Date(2027, 3, 10, 12, 0, 0, 0, time.UTC)

	wide, err := db.Summary(t.Context(), history.StatsQuery{Days: 5000, Now: now, In: time.UTC})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if wide.Days != history.MaxDays || len(wide.Rows) != history.MaxDays {
		t.Errorf("asking for 5000 days answered with %d days and %d rows, expected %d of each",
			wide.Days, len(wide.Rows), history.MaxDays)
	}

	if wide.Days == 5000 {
		t.Error("the answer claims the window it was asked for rather than the one it used")
	}

	none, err := db.Summary(t.Context(), history.StatsQuery{Now: now, In: time.UTC})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if none.Days != history.DefaultDays || len(none.Rows) != history.DefaultDays {
		t.Errorf("asking for no particular window answered with %d days and %d rows, expected %d of each",
			none.Days, len(none.Rows), history.DefaultDays)
	}
}

// A machine whose clock was wrong and then corrected has runs stamped in the
// future, which would count in the totals and on no bar.
func TestARunOutsideTheWindowIsNotCounted(t *testing.T) {
	db := openTemp(t)
	now := time.Date(2027, 3, 10, 12, 0, 0, 0, time.UTC)

	record(t, db, "photos", now.AddDate(0, 0, -100), history.Run{Copied: 500})
	record(t, db, "photos", now.AddDate(0, 0, 2), history.Run{Copied: 900})
	record(t, db, "photos", now, history.Run{Copied: 4})

	got, err := db.Summary(t.Context(), history.StatsQuery{Days: 7, Now: now, In: time.UTC})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if got.Totals.Runs != 1 || got.Totals.Copied != 4 {
		t.Errorf("a seven day window counted %d runs and %d copied, expected the one run inside it",
			got.Totals.Runs, got.Totals.Copied)
	}
	for _, row := range got.Rows {
		if row.Copied != 0 && row.Day != "2027-03-10" {
			t.Errorf("%s reports %d copied, and nothing ran that day", row.Day, row.Copied)
		}
	}
}

func TestTheTotalsAreTheSumOfTheBars(t *testing.T) {
	db := openTemp(t)
	now := time.Date(2027, 3, 10, 12, 0, 0, 0, time.UTC)

	record(t, db, "photos", now.AddDate(0, 0, -2), history.Run{Copied: 5, Trashed: 1, Conflicts: 2})
	record(t, db, "docs", now.AddDate(0, 0, -2), history.Run{Copied: 3, Skipped: 4})
	record(t, db, "photos", now, history.Run{Copied: 11, Err: "left side is gone"})

	got, err := db.Summary(t.Context(), history.StatsQuery{Days: 7, Now: now, In: time.UTC})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}

	var sum history.Counts
	for _, row := range got.Rows {
		sum.Runs += row.Runs
		sum.Failed += row.Failed
		sum.Copied += row.Copied
		sum.Trashed += row.Trashed
		sum.Conflicts += row.Conflicts
		sum.Skipped += row.Skipped
	}
	if sum.Runs != got.Totals.Runs || sum.Copied != got.Totals.Copied ||
		sum.Trashed != got.Totals.Trashed || sum.Conflicts != got.Totals.Conflicts ||
		sum.Skipped != got.Totals.Skipped || sum.Failed != got.Totals.Failed {
		t.Errorf("the bars add up to %+v and the totals say %+v", sum, got.Totals)
	}
	// Two totals from the same broken pass would agree with each other.
	if got.Totals.Runs != 3 || got.Totals.Copied != 19 || got.Totals.Skipped != 4 {
		t.Errorf("three runs copying 19 files between them came back as %+v", got.Totals)
	}
}

// A failure taken out of the run count would make a job failing every fifteen
// minutes look like a quiet day.
func TestAFailedRunIsStillARun(t *testing.T) {
	db := openTemp(t)
	now := time.Date(2027, 3, 10, 12, 0, 0, 0, time.UTC)

	record(t, db, "photos", now, history.Run{Err: "left side is gone"})
	record(t, db, "photos", now, history.Run{Copied: 1})

	got, err := db.Summary(t.Context(), history.StatsQuery{Days: 1, Now: now, In: time.UTC})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	row := rowFor(t, got, "2027-03-10", "")
	if row.Runs != 2 {
		t.Errorf("two runs happened and the day reports %d", row.Runs)
	}
	if row.Failed != 1 {
		t.Errorf("one of the two failed and the day reports %d failures", row.Failed)
	}
	if row.Failed == row.Runs {
		t.Error("the successful run was counted as a failure as well")
	}
}

func TestPerJobRowsKeepTheJobsApart(t *testing.T) {
	db := openTemp(t)
	now := time.Date(2027, 3, 10, 12, 0, 0, 0, time.UTC)

	record(t, db, "photos", now, history.Run{Copied: 10})
	record(t, db, "docs", now, history.Run{Copied: 4})

	split, err := db.Summary(t.Context(), history.StatsQuery{Days: 1, ByJob: true, Now: now, In: time.UTC})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if len(split.Rows) != 2 {
		t.Fatalf("two jobs ran on one day and the split summary has %d rows: %+v", len(split.Rows), split.Rows)
	}
	if split.Rows[0].Job != "docs" || split.Rows[1].Job != "photos" {
		t.Errorf("the lines are in the order %q, %q rather than sorted", split.Rows[0].Job, split.Rows[1].Job)
	}
	if n := rowFor(t, split, "2027-03-10", "photos").Copied; n != 10 {
		t.Errorf("photos copied 10 and its own row says %d", n)
	}
	if n := rowFor(t, split, "2027-03-10", "docs").Copied; n != 4 {
		t.Errorf("docs copied 4 and its own row says %d", n)
	}

	together, err := db.Summary(t.Context(), history.StatsQuery{Days: 1, Now: now, In: time.UTC})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if len(together.Rows) != 1 {
		t.Fatalf("one day without a split came back as %d rows: %+v", len(together.Rows), together.Rows)
	}
	if together.Rows[0].Job != "" {
		t.Errorf("a row covering every job names %q", together.Rows[0].Job)
	}
	if together.Rows[0].Copied != 14 {
		t.Errorf("two jobs copying 10 and 4 add up to %d on the shared row", together.Rows[0].Copied)
	}
}

// A job that has stopped working has no rows, and its chart still has to show
// the flat line.
func TestAJobThatDidNothingStillDrawsItsFlatLine(t *testing.T) {
	db := openTemp(t)
	now := time.Date(2027, 3, 10, 12, 0, 0, 0, time.UTC)

	// Another job is busy, so an empty database cannot pass the test.
	record(t, db, "docs", now, history.Run{Copied: 9})

	got, err := db.Summary(t.Context(), history.StatsQuery{Job: "photos", Days: 7, Now: now, In: time.UTC})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if len(got.Rows) != 7 {
		t.Fatalf("a silent job over seven days came back with %d rows rather than seven flat ones", len(got.Rows))
	}
	for _, row := range got.Rows {
		if row.Job != "photos" {
			t.Fatalf("a summary narrowed to photos has a row for %q", row.Job)
		}
		if row.Runs != 0 || row.Copied != 0 {
			t.Errorf("photos never ran and %s reports %+v, which is the other job's work", row.Day, row.Counts)
		}
	}
	if got.Totals.Runs != 0 {
		t.Errorf("photos never ran and the totals say %d runs", got.Totals.Runs)
	}
}

// A nil slice encodes as null and breaks the chart. Splitting per job with
// nothing to split is the only shape that does not fill its days in.
func TestAskingForEveryJobOnAFreshMachineIsAListAndNotNull(t *testing.T) {
	db := openTemp(t)
	now := time.Date(2027, 3, 10, 12, 0, 0, 0, time.UTC)

	got, err := db.Summary(t.Context(), history.StatsQuery{Days: 7, ByJob: true, Now: now, In: time.UTC})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if got.Rows == nil {
		t.Fatal("a machine that has never run anything came back with a nil list of rows")
	}
	if len(got.Rows) != 0 {
		t.Fatalf("nothing has ever run and the answer holds %d rows", len(got.Rows))
	}

	body, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if string(raw["rows"]) != "[]" {
		t.Errorf("the empty answer encodes rows as %s rather than as an empty list", raw["rows"])
	}
}
