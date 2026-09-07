package history

import (
	"context"
	"fmt"
	"slices"
	"time"
)

// Statistics over time, which is the one question the run list cannot answer.
//
// The list of recent runs says what the last fifty runs did, and fifty runs is
// somewhere between an afternoon and a year depending on the schedule, so
// scrolling it is not a way to find out whether a job is doing more work than it
// used to or has quietly stopped doing any. That is the same failure the package
// itself exists for, one level up: a job copying nothing for three weeks reads
// as fifty tidy green rows, and only a shape drawn over time makes the flat line
// visible. This folds the same rows into one bucket per day, which is what a
// chart needs and what a list of runs is not.

// dayLayout is the label a bucket carries. A calendar day, not an instant.
const dayLayout = "2006-01-02"

// DefaultDays is the window used when a caller does not ask for one.
const DefaultDays = 30

// MaxDays is the widest window this will answer, and it does not exist out of
// politeness to the database.
//
// A summary with no upper bound is an invitation to ask for everything ever, and
// on a run log nobody has pruned, belonging to a job that runs every fifteen
// minutes, everything ever means handing a browser tens of thousands of rows so
// it can draw a chart three hundred pixels wide. A year and a day is wide enough
// that "the last year" is a single request on a leap year too, and narrow enough
// that the answer stays something a person and a browser can both take in.
const MaxDays = 366

// Counts are the numbers a run reports, added up.
//
// The same shape serves one day, one job's day and the whole window on purpose.
// A summary that changed shape at each level would make everything reading it
// unpack three different things to add up the same nine numbers.
type Counts struct {
	Runs int `json:"runs"`
	// Failed is counted separately and NOT subtracted from Runs, because the
	// two answer different questions: how busy was this day, and how much of
	// that busyness was a job failing over and over. A run that failed is still
	// a run that happened.
	Failed int `json:"failed"`

	Copied      int `json:"copied"`
	Moved       int `json:"moved"`
	Trashed     int `json:"trashed"`
	Conflicts   int `json:"conflicts"`
	DirsMade    int `json:"dirsMade"`
	DirsRemoved int `json:"dirsRemoved"`
	Unchanged   int `json:"unchanged"`
	Skipped     int `json:"skipped"`
}

// add folds one run into the counts.
func (c *Counts) add(r Run) {
	c.Runs++
	if r.Failed() {
		c.Failed++
	}
	c.Copied += r.Copied
	c.Moved += r.Moved
	c.Trashed += r.Trashed
	c.Conflicts += r.Conflicts
	c.DirsMade += r.DirsMade
	c.DirsRemoved += r.DirsRemoved
	c.Unchanged += r.Unchanged
	c.Skipped += r.Skipped
}

// DailyStat is one bar of the chart: what happened on one day, for one job or
// for every job together.
type DailyStat struct {
	// Day is the calendar day the bucket covers, in the zone the summary was cut
	// in, written as YYYY-MM-DD. A string rather than a timestamp because a
	// string is what it honestly is: a label for a bucket. Handing back midnight
	// as an instant invites whatever draws the chart to convert it into some
	// other zone, and a bar that has been shifted by an hour is a bar with the
	// wrong date on it for part of every day.
	Day string `json:"day"`

	// Job names what this row counts. Empty means every job together, which is
	// what a single line chart wants.
	Job string `json:"job"`

	Counts
}

// StatsQuery asks for one summary.
type StatsQuery struct {
	// Job narrows the summary to one job. Empty means every job.
	Job string

	// Days is how many calendar days the window covers, counting back from and
	// including the day Now falls on. Zero or less means DefaultDays, and
	// anything wider than MaxDays is cut down to it. The answer reports the
	// number actually used rather than swallowing the difference, so a caller
	// that asked for more can say so instead of labelling a shorter chart with
	// the window it thought it had.
	Days int

	// ByJob draws one line per job instead of one line for the whole machine. It
	// changes nothing when Job is set, because a summary narrowed to one job is
	// already one line.
	ByJob bool

	// Now is the moment the window ends at. The zero value means the real time;
	// only the tests set this, and they set it because a test whose result
	// depends on what today happens to be is a test that fails one morning for
	// no reason anybody can reproduce.
	Now time.Time

	// In is the zone the days are cut in. Nil means the machine's own zone.
	//
	// This is the one decision here that deserves an argument rather than a
	// note. A day is not a fact about an instant, it is a fact about an instant
	// AND a zone, so something has to be picked, and picking UTC because the
	// timestamps happen to be stored as UnixNano would be picking silently: a
	// run at 01:00 on a Tuesday in Berlin is still Monday in UTC, so every
	// night's work would be drawn on the wrong bar for everybody east of
	// Greenwich, and every evening's work for everybody far enough west. The
	// machine's own zone is the honest default for a tool somebody runs on their
	// own machine, because the day they mean when they point at a bar is the day
	// their own clock showed.
	In *time.Location
}

// Stats is one answer: the bars, the totals under them, and what was actually
// asked so a caller can label the chart with the window it really got.
type Stats struct {
	// From and To are the first and last day in the window, inclusive, in the
	// same YYYY-MM-DD form the rows carry.
	From string `json:"from"`
	To   string `json:"to"`

	// Days is the window that was used, which is not always the window that was
	// requested. See StatsQuery.Days.
	Days int `json:"days"`

	// Zone is the abbreviation in effect at the end of the window, so a chart
	// can say which midnight it cut the bars at instead of leaving a reader to
	// assume it was theirs. Not the location's own name, which is the bare word
	// "Local" for the default and tells nobody anything. A window that spans a
	// clock change was cut under two different abbreviations and the bars are
	// still right: every run is converted on its own, so the changeover lands
	// where it actually landed.
	Zone string `json:"zone"`

	// Job and ByJob are echoed back because an answer that does not say what
	// question it answers is an answer a caller has to remember the question
	// for, and a browser that fires two requests and races them will eventually
	// draw one labelled as the other.
	Job   string `json:"job"`
	ByJob bool   `json:"byJob"`

	// Rows is one entry per day, or per job per day. Never nil. See Summary.
	Rows []DailyStat `json:"rows"`

	// Totals is the whole window added up, which is the number that goes beside
	// the chart rather than in it.
	Totals Counts `json:"totals"`
}

// bucket is what a row is accumulated under before it becomes a DailyStat.
type bucket struct {
	day string
	job string
}

// Summary folds the run log into one row per day over a bounded window.
//
// Every day in the window comes back, including the ones nothing ran on. That is
// deliberate and it is the whole reason this returns a filled range rather than
// whatever the database happened to have: a chart drawn from only the days that
// have rows draws the quiet week as a gap, and a gap in a chart reads as missing
// data rather than as an idle machine. Those two mean opposite things, and the
// second one is exactly what somebody opens this page to find out.
func (d *DB) Summary(ctx context.Context, q StatsQuery) (Stats, error) {
	days := q.Days
	if days <= 0 {
		days = DefaultDays
	}
	if days > MaxDays {
		days = MaxDays
	}
	loc := q.In
	if loc == nil {
		loc = time.Local
	}
	now := q.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = now.In(loc)

	// The window is walked as a calendar rather than as multiples of 24 hours,
	// because a day is not always 24 hours long. In any zone that moves its
	// clocks, taking 24 hours off a midnight lands at 23:00 or 01:00 of the day
	// before, and a range built that way drifts one hour further out of step
	// with each step it takes, until eventually two entries carry the same date
	// and one day is missing from the chart altogether. time.Date normalises a
	// day number outside the month for us, so subtracting past the first falls
	// into the previous month correctly and without any arithmetic here.
	labels := make([]string, days)
	for i := range labels {
		labels[i] = time.Date(now.Year(), now.Month(), now.Day()-(days-1)+i, 0, 0, 0, 0, loc).Format(dayLayout)
	}
	first := time.Date(now.Year(), now.Month(), now.Day()-(days-1), 0, 0, 0, 0, loc)
	end := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, loc)

	out := Stats{
		From: labels[0], To: labels[len(labels)-1],
		Days: days, Job: q.Job, ByJob: q.ByJob,
	}
	out.Zone, _ = now.Zone()

	// Narrowing to one job makes ByJob meaningless, and keeping the two apart
	// here rather than at every use below is what stops a row from being filed
	// under a job name while the series it belongs to is called something else,
	// which would leave every bar reading zero.
	splitByJob := q.ByJob && q.Job == ""

	// BOTH ends of the window go into the query, so the only rows that come back
	// are rows the answer already has a bucket for. That is what lets the totals
	// below simply be the sum of the buckets: a row the query let through and
	// the bucketing then had nowhere to put would land in a total the chart does
	// not add up to, and a total that disagrees with the chart underneath it is
	// worse than no total at all, because it looks authoritative.
	query := `SELECT job, started, copied, moved, trashed, conflicts, dirs_made, dirs_removed, unchanged, skipped, err
	          FROM runs WHERE started >= ? AND started < ?`
	args := []any{first.UnixNano(), end.UnixNano()}
	if q.Job != "" {
		query += ` AND job = ?`
		args = append(args, q.Job)
	}

	rows, err := d.sql.QueryContext(ctx, query, args...)
	if err != nil {
		return Stats{}, fmt.Errorf("summarise history: %w", err)
	}
	defer rows.Close()

	buckets := map[bucket]*Counts{}
	seen := map[string]bool{}
	for rows.Next() {
		var r Run
		var started int64
		if err := rows.Scan(&r.Job, &started, &r.Copied, &r.Moved, &r.Trashed, &r.Conflicts,
			&r.DirsMade, &r.DirsRemoved, &r.Unchanged, &r.Skipped, &r.Err); err != nil {
			return Stats{}, fmt.Errorf("scan run for summary: %w", err)
		}
		// Converted one run at a time, which is the only way a window spanning a
		// clock change comes out right: the offset is asked for at the instant
		// the run actually happened, not once for the whole window.
		key := bucket{day: time.Unix(0, started).In(loc).Format(dayLayout)}
		if splitByJob {
			key.job = r.Job
		}
		into := buckets[key]
		if into == nil {
			into = &Counts{}
			buckets[key] = into
		}
		into.add(r)
		out.Totals.add(r)
		seen[r.Job] = true
	}
	if err := rows.Err(); err != nil {
		return Stats{}, fmt.Errorf("read history for summary: %w", err)
	}

	// One series per line the chart draws. Asking about a named job gives that
	// job even when it did nothing at all in the window, and that case is the
	// point rather than an edge of it: a job that has quietly stopped working
	// has no rows to build a series from, so a series built only from what the
	// database returned would answer "this job does not exist" to the exact
	// question "has this job been doing anything".
	series := []string{q.Job}
	if splitByJob {
		series = make([]string, 0, len(seen))
		for job := range seen {
			series = append(series, job)
		}
		// Sorted, because a map hands its keys back in a different order every
		// time, and a chart whose lines swap colours between two refreshes is a
		// chart nobody can compare against the one they were just looking at.
		slices.Sort(series)
	}

	// make, not var. A nil slice encodes as JSON null, and whatever draws this
	// treats a list as a list: the first map or filter over a null takes the
	// whole page down. The case that gets there is the empty one, asking for
	// every job on a machine that has not run anything yet, which is a fresh
	// installation and never a machine anybody develops on.
	out.Rows = make([]DailyStat, 0, len(labels)*len(series))
	for _, day := range labels {
		for _, job := range series {
			row := DailyStat{Day: day, Job: job}
			key := bucket{day: day}
			if splitByJob {
				key.job = job
			}
			if c := buckets[key]; c != nil {
				row.Counts = *c
			}
			out.Rows = append(out.Rows, row)
		}
	}
	return out, nil
}
