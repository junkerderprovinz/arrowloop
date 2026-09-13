package web

import (
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

/*
When the clock will next reach a job, and the three ways it never will.

jdp asked the overview to look like Autosync's, and Autosync's status card says
"Nächste Sync" on its own line. A time printed there for a job the clock is
never going to start would be a promise nobody keeps - which is worse than the
empty line it replaced, because an empty line asks a question and a wrong time
answers one.
*/
func TestWhenTheClockNextReachesAJob(t *testing.T) {
	// A Monday, so the weekday expression below has a day to land on.
	now := time.Date(2027, 3, 1, 12, 30, 0, 0, time.UTC)

	for _, c := range []struct {
		name     string
		schedule string
		disabled bool
		want     time.Time
		haveTime bool
	}{
		{
			name:     "every four hours, on the hour",
			schedule: "0 0,4,8,12,16,20 * * *",
			want:     time.Date(2027, 3, 1, 16, 0, 0, 0, time.UTC),
			haveTime: true,
		},
		{
			name:     "a plain interval counts from now",
			schedule: "@every 15m",
			want:     now.Add(15 * time.Minute),
			haveTime: true,
		},
		{
			name:     "every day at three, so tomorrow",
			schedule: "0 3 * * *",
			want:     time.Date(2027, 3, 2, 3, 0, 0, 0, time.UTC),
			haveTime: true,
		},
		// THE THREE SILENCES, and they are one answer to a reader: the clock is
		// not going to start this job.
		{name: "no schedule at all, so it runs when somebody says so", schedule: ""},
		{name: "whitespace is no schedule either", schedule: "   "},
		{name: "switched off, whatever the expression says", schedule: "0 3 * * *", disabled: true},
		{name: "an expression that does not parse", schedule: "jeden dienstag bitte"},
	} {
		t.Run(c.name, func(t *testing.T) {
			got, ok := nextRun(job.Job{Schedule: c.schedule, Disabled: c.disabled}, now)
			if ok != c.haveTime {
				t.Fatalf("have a time = %v, want %v (got %v)", ok, c.haveTime, got)
			}
			if ok && !got.Equal(c.want) {
				t.Errorf("next run %v, want %v", got, c.want)
			}
		})
	}
}

/*
A WATCHING job still gets its time.

The watcher is not a schedule; it is a shortcut that reacts sooner. The
schedule behind it is the backstop and the thing that will definitely happen,
so hiding the time for a watching job would hide the only guarantee it has.
*/
func TestAWatchingJobStillHasItsBackstop(t *testing.T) {
	now := time.Date(2027, 3, 1, 12, 30, 0, 0, time.UTC)
	when, ok := nextRun(job.Job{Schedule: "@every 1h", Watch: true}, now)
	if !ok {
		t.Fatal("a watching job with a schedule reported no next run")
	}
	if !when.Equal(now.Add(time.Hour)) {
		t.Errorf("next run %v, want %v", when, now.Add(time.Hour))
	}
}
