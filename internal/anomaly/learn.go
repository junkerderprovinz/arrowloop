package anomaly

import (
	"fmt"
	"math"
	"slices"
	"time"
)

// LearnAfter is how many successful runs a job needs before its runs are
// judged. Fewer say too little about what is usual for it.
const LearnAfter = 10

// LearnFrom is how many of a job's latest successful runs are learned from, so
// a job that changed its habits is judged by what it does now.
const LearnFrom = 50

// spread is how many median absolute deviations above the median a figure has
// to be to stand out. Median and deviation are robust, so one odd run among
// the learned ones does not move them.
const spread = 6

// The floors a figure also has to reach. Against a job that never deletes
// anything every deletion is beyond any spread, and a handful is no news.
const (
	floorDeleted = 20
	floorCopied  = 50
	floorLonger  = 5 * time.Minute
)

// Figure is one thing measured about a run.
type Figure string

const (
	Deleted  Figure = "deleted"
	Copied   Figure = "copied"
	Duration Figure = "duration"
)

// Sample is what one successful run did.
type Sample struct {
	Deleted int
	Copied  int
	Took    time.Duration
}

func (s Sample) value(f Figure) int64 {
	switch f {
	case Deleted:
		return int64(s.Deleted)
	case Copied:
		return int64(s.Copied)
	}
	return int64(s.Took / time.Second)
}

var figures = []Figure{Deleted, Copied, Duration}

// Usual is the range a figure usually falls in, from the tenth to the
// ninetieth percentile of the learned runs. Durations are in seconds.
type Usual struct {
	Figure Figure `json:"figure"`
	Low    int64  `json:"low"`
	High   int64  `json:"high"`

	median, deviation float64
}

// Measure is a figure of one run that left its usual range.
type Measure struct {
	Figure Figure `json:"figure"`
	Value  int64  `json:"value"`
	Low    int64  `json:"low"`
	High   int64  `json:"high"`
}

// Learning is what a job's runs taught about it.
type Learning struct {
	// Runs is how many runs it learned from, at most LearnFrom.
	Runs int `json:"runs"`
	// Usual is each figure's range, once the job is learned.
	Usual []Usual `json:"usual,omitempty"`
}

// Learn learns from a job's successful runs, newest first.
func Learn(runs []Sample) Learning {
	if len(runs) > LearnFrom {
		runs = runs[:LearnFrom]
	}
	l := Learning{Runs: len(runs)}
	if !l.Learned() {
		return l
	}
	for _, f := range figures {
		values := make([]float64, len(runs))
		for i, r := range runs {
			values[i] = float64(r.value(f))
		}
		slices.Sort(values)
		mid := median(values)
		off := make([]float64, len(values))
		for i, v := range values {
			off[i] = math.Abs(v - mid)
		}
		slices.Sort(off)
		l.Usual = append(l.Usual, Usual{
			Figure: f, Low: int64(rank(values, 0.1)), High: int64(rank(values, 0.9)),
			median: mid, deviation: median(off),
		})
	}
	return l
}

// Learned reports whether there are runs enough to judge by.
func (l Learning) Learned() bool { return l.Runs >= LearnAfter }

// Unusual returns the figures of a run that stand out against what was
// learned, in the order deleted, copied, duration.
func (l Learning) Unusual(run Sample) []Measure {
	var out []Measure
	for _, u := range l.Usual {
		v := run.value(u.Figure)
		if float64(v) <= u.median+spread*u.deviation || !pastFloor(u, v) {
			continue
		}
		out = append(out, Measure{Figure: u.Figure, Value: v, Low: u.Low, High: u.High})
	}
	return out
}

func pastFloor(u Usual, v int64) bool {
	switch u.Figure {
	case Deleted:
		return v >= floorDeleted
	case Copied:
		return v >= floorCopied
	}
	return float64(v)-u.median >= floorLonger.Seconds()
}

// Say is a measure in plain English, for the log and a message.
func (m Measure) Say() string {
	switch m.Figure {
	case Deleted:
		return fmt.Sprintf("deleted %d files; usually %d to %d", m.Value, m.Low, m.High)
	case Copied:
		return fmt.Sprintf("copied %d files; usually %d to %d", m.Value, m.Low, m.High)
	}
	took := func(s int64) string { return (time.Duration(s) * time.Second).String() }
	return fmt.Sprintf("took %s; usually %s to %s", took(m.Value), took(m.Low), took(m.High))
}

// median of sorted values.
func median(sorted []float64) float64 {
	n := len(sorted)
	if n%2 == 1 {
		return sorted[n/2]
	}
	return (sorted[n/2-1] + sorted[n/2]) / 2
}

// rank is the nearest-rank percentile of sorted values.
func rank(sorted []float64, p float64) float64 {
	i := int(math.Ceil(p*float64(len(sorted)))) - 1
	return sorted[max(i, 0)]
}
