package anomaly

import (
	"testing"
	"time"
)

// steady is n runs of the same shape with a little noise, the way a daily job
// looks: a handful of files deleted and copied, a minute or two long.
func steady(n int) []Sample {
	out := make([]Sample, n)
	for i := range out {
		out[i] = Sample{Deleted: i % 7, Copied: 20 + i%9, Took: time.Duration(60+i%30) * time.Second}
	}
	return out
}

func TestAJobLearnsNothingBeforeItsTenthRun(t *testing.T) {
	l := Learn(steady(LearnAfter - 1))
	if l.Learned() || l.Runs != LearnAfter-1 {
		t.Fatalf("after %d runs the job counts as learned with %d runs", LearnAfter-1, l.Runs)
	}
	if got := l.Unusual(Sample{Deleted: 5000}); len(got) != 0 {
		t.Errorf("a job still learning called a run unusual: %+v", got)
	}
	if !Learn(steady(LearnAfter)).Learned() {
		t.Errorf("after %d runs the job is still learning", LearnAfter)
	}
}

func TestLearningCountsTheLatestRunsOnly(t *testing.T) {
	runs := steady(LearnFrom)
	// Older runs that deleted thousands each must not widen what is usual.
	for range 30 {
		runs = append(runs, Sample{Deleted: 3000})
	}
	l := Learn(runs)
	if l.Runs != LearnFrom {
		t.Fatalf("learned from %d runs, want %d", l.Runs, LearnFrom)
	}
	if got := l.Unusual(Sample{Deleted: 412, Copied: 22, Took: time.Minute}); len(got) != 1 {
		t.Errorf("a spike after a steady stretch went unnoticed: %+v", got)
	}
}

func TestASpikeInDeletionsIsUnusual(t *testing.T) {
	l := Learn(steady(30))
	got := l.Unusual(Sample{Deleted: 412, Copied: 22, Took: 70 * time.Second})
	if len(got) != 1 || got[0].Figure != Deleted || got[0].Value != 412 {
		t.Fatalf("expected the deletions alone to stand out, got %+v", got)
	}
	if got[0].Low != 0 || got[0].High != 6 {
		t.Errorf("the usual range reads %d to %d, want 0 to 6", got[0].Low, got[0].High)
	}
}

func TestASteadyRunIsUsual(t *testing.T) {
	l := Learn(steady(30))
	if got := l.Unusual(Sample{Deleted: 6, Copied: 28, Took: 89 * time.Second}); len(got) != 0 {
		t.Errorf("a run inside the learned range was called unusual: %+v", got)
	}
}

func TestAJobThatGrowsSlowlyIsNotFlagged(t *testing.T) {
	runs := make([]Sample, 40)
	for i := range runs {
		// Newest first, as the history hands them out: the oldest copied 100.
		runs[i] = Sample{Copied: 140 - i, Took: time.Duration(300-i) * time.Second}
	}
	if got := Learn(runs).Unusual(Sample{Copied: 145, Took: 305 * time.Second}); len(got) != 0 {
		t.Errorf("the next step of a slow growth was called unusual: %+v", got)
	}
}

func TestAQuietJobNeedsTheFloorBeforeItFlags(t *testing.T) {
	zeros := make([]Sample, 20)
	l := Learn(zeros)
	// Against runs that never delete anything, every deletion is beyond six
	// deviations; the floor keeps a few from being news.
	if got := l.Unusual(Sample{Deleted: 19, Copied: 49}); len(got) != 0 {
		t.Errorf("a handful of files on a quiet job was called unusual: %+v", got)
	}
	got := l.Unusual(Sample{Deleted: 20, Copied: 50})
	if len(got) != 2 || got[0].Figure != Deleted || got[1].Figure != Copied {
		t.Errorf("twenty deletions and fifty copies on a quiet job went unnoticed: %+v", got)
	}
}

func TestALongerRunNeedsFiveMinutesMoreThanUsual(t *testing.T) {
	l := Learn(steady(30))
	if got := l.Unusual(Sample{Took: 5 * time.Minute}); len(got) != 0 {
		t.Errorf("a run under five minutes longer than usual was flagged: %+v", got)
	}
	got := l.Unusual(Sample{Took: 7 * time.Minute})
	if len(got) != 1 || got[0].Figure != Duration || got[0].Value != 420 {
		t.Errorf("a run seven minutes long against one or two went unnoticed: %+v", got)
	}
}

func TestTheUsualRangeIsGivenPerFigure(t *testing.T) {
	l := Learn(steady(30))
	if len(l.Usual) != 3 {
		t.Fatalf("expected a range for each of the three figures, got %+v", l.Usual)
	}
	for _, u := range l.Usual {
		if u.Low > u.High {
			t.Errorf("%s runs from %d down to %d", u.Figure, u.Low, u.High)
		}
	}
	if Learn(steady(3)).Usual != nil {
		t.Error("a job still learning showed a usual range")
	}
}

func TestAnUnusualRunIsANoteThatHoldsNothing(t *testing.T) {
	if Unusual.Holds() || Unusual.Severity() != "warning" {
		t.Errorf("an unusual run holds %v at severity %s", Unusual.Holds(), Unusual.Severity())
	}
}
