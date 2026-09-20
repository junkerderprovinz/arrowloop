package history

import (
	"context"
	"fmt"
	"slices"
	"time"
)

// dayLayout is the label a bucket carries. A calendar day, not an instant.
const dayLayout = "2006-01-02"

// DefaultDays is the window used when a caller does not ask for one.
const DefaultDays = 30

// MaxDays is the widest window this will answer, so a chart is never handed
// tens of thousands of rows. A year and a day covers a leap year.
const MaxDays = 366

// Counts are the numbers a run reports, added up. The same shape serves one
// day, one job's day and the whole window.
type Counts struct {
	Runs int `json:"runs"`
	// Failed is included in Runs, not subtracted from it.
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
	// in, as YYYY-MM-DD. It is a label rather than an instant, so the chart
	// cannot shift it into another zone.
	Day string `json:"day"`

	// Job names what this row counts. Empty means every job together.
	Job string `json:"job"`

	Counts
}

// StatsQuery asks for one summary.
type StatsQuery struct {
	// Job narrows the summary to one job. Empty means every job.
	Job string

	// Days is how many calendar days the window covers, counting back from and
	// including the day Now falls on. Zero or less means DefaultDays, and
	// anything wider than MaxDays is cut down to it; Stats.Days reports the
	// number used.
	Days int

	// ByJob draws one line per job instead of one for the whole machine. It
	// changes nothing when Job is set.
	ByJob bool

	// Now is the moment the window ends at. The zero value means the real time.
	Now time.Time

	// In is the zone the days are cut in. Nil means the machine's own zone,
	// because the day somebody means when pointing at a bar is the day their
	// clock showed; in UTC a run at 01:00 in Berlin would land on the day
	// before.
	In *time.Location
}

// Stats is one answer: the bars, the totals under them, and the window that
// was actually used.
type Stats struct {
	// From and To are the first and last day in the window, inclusive, in the
	// same YYYY-MM-DD form the rows carry.
	From string `json:"from"`
	To   string `json:"to"`

	// Days is the window that was used. See StatsQuery.Days.
	Days int `json:"days"`

	// Zone is the abbreviation in effect at the end of the window, so a chart
	// can say which midnight it cut the bars at. The location's name would be
	// "Local" for the default.
	Zone string `json:"zone"`

	// Job and ByJob echo the question, so a browser racing two requests
	// cannot label one answer as the other.
	Job   string `json:"job"`
	ByJob bool   `json:"byJob"`

	// Rows is one entry per day, or per job per day. Never nil. See Summary.
	Rows []DailyStat `json:"rows"`

	// Totals is the whole window added up.
	Totals Counts `json:"totals"`
}

// bucket is what a row is accumulated under before it becomes a DailyStat.
type bucket struct {
	day string
	job string
}

// Summary folds the run log into one row per day over a bounded window. Every
// day comes back, including the ones nothing ran on, so an idle week is drawn
// as zeros rather than as a gap that reads like missing data.
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

	// Walked as a calendar rather than in steps of 24 hours, since a day
	// across a clock change is not 24 hours long. time.Date normalises a day
	// number outside the month.
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

	// Decided once, so a row is never filed under a job name while its series
	// is called something else.
	splitByJob := q.ByJob && q.Job == ""

	// Both ends of the window go into the query, so every row has a bucket
	// and the totals add up to the chart.
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
		// Converted per run, so the offset is the one in effect when the run
		// happened.
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

	// A named job gets its series even when it did nothing in the window,
	// which is the case somebody asking about it wants to see.
	series := []string{q.Job}
	if splitByJob {
		series = make([]string, 0, len(seen))
		for job := range seen {
			series = append(series, job)
		}
		// Sorted so the lines keep their colours between refreshes.
		slices.Sort(series)
	}

	// A nil slice would encode as null and break the chart on a fresh install.
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
