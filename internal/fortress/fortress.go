// Package fortress turns what the engine knows into the status report and the
// log every app of a fortress answers with: the jobs that need somebody, the
// runs in progress, the runs to come and what the runs did.
package fortress

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/status"

	"github.com/junkerderprovinz/arrowloop/internal/anomaly"
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// Snapshot is what the engine knows at one moment.
type Snapshot struct {
	App      status.App
	Instance status.Instance
	Jobs     []job.Job
	// Findings are the open ones.
	Findings []anomaly.Finding
	// Latest is each job's newest stored run.
	Latest  []history.Run
	Working []daemon.Working
	Now     time.Time
}

// Report builds the status report with its texts in lang.
func Report(s Snapshot, lang string) status.Report {
	tr := translator(lang)
	enabled := map[string]job.Job{}
	for _, j := range s.Jobs {
		if !j.Disabled {
			enabled[j.Name] = j
		}
	}

	r := status.Report{App: s.App, Instance: s.Instance, State: status.StateOff, SampledAt: s.Now.UTC()}
	if len(enabled) > 0 {
		r.State = status.StateOK
	}

	found := map[string]bool{}
	for _, f := range s.Findings {
		found[f.Job] = true
		r.NeedsYou = append(r.NeedsYou, findingNeed(f, tr))
		if f.Kind == anomaly.Overdue {
			r.State = status.Worst(r.State, status.StateOverdue)
		}
	}
	for _, run := range s.Latest {
		if _, ok := enabled[run.Job]; !ok {
			continue
		}
		switch {
		case run.Failed() && !found[run.Job]:
			r.NeedsYou = append(r.NeedsYou, status.Need{
				ID: "failed-" + run.Job, Severity: status.SeverityError, Code: "job.failed",
				Text: tr("need.failed", run.Job, 0), Since: run.Finished.UTC(), Link: "/history",
			})
		case !run.Failed() && run.Skipped > 0:
			r.NeedsYou = append(r.NeedsYou, status.Need{
				ID: "left-" + run.Job, Severity: status.SeverityWarn, Code: "job.left",
				Text: tr("need.left", run.Job, run.Skipped), Since: run.Finished.UTC(), Link: "/history",
			})
		}
	}

	for _, w := range s.Working {
		t := status.Task{
			ID:            "run-" + w.Job + "-" + strconv.FormatInt(w.Started.UnixNano(), 10),
			Kind:          status.KindSync,
			Title:         w.Job,
			StartedAt:     w.Started.UTC(),
			BlocksRestart: deletes(enabled[w.Job]),
		}
		if w.Total > 0 {
			p := min(float64(w.Done)/float64(w.Total), 1)
			t.Progress = &p
		}
		r.Work = append(r.Work, t)
	}

	for _, j := range s.Jobs {
		if j.Disabled || strings.TrimSpace(j.Schedule) == "" {
			continue
		}
		schedule, err := job.ParseSchedule(j.Schedule)
		if err != nil {
			continue
		}
		r.Next = append(r.Next, status.Scheduled{Kind: status.KindSync, Title: j.Name, At: schedule.Next(s.Now).UTC()})
	}
	sort.SliceStable(r.Next, func(a, b int) bool { return r.Next[a].At.Before(r.Next[b].At) })
	return r
}

// deletes reports whether stopping the job halfway leaves a side short of
// files: a mirror and a move delete as they go.
func deletes(j job.Job) bool { return j.Mode == "mirror" || j.Mode == "move" }

func findingNeed(f anomaly.Finding, tr func(key, job string, count int) string) status.Need {
	n := status.Need{ID: "finding-" + f.ID, Severity: severity(f.Kind), Since: f.Since.UTC(), Link: "/anomalies"}
	switch f.Kind {
	case anomaly.Delete, anomaly.Change, anomaly.Empty:
		n.Code = "job.held"
		n.Text = tr("need.held."+string(f.Kind), f.Job, f.Count)
	default:
		n.Code = "job." + string(f.Kind)
		n.Text = tr("need."+string(f.Kind), f.Job, f.Count)
	}
	return n
}

func severity(k anomaly.Kind) status.Severity {
	switch k.Severity() {
	case "critical":
		return status.SeverityError
	case "info":
		return status.SeverityInfo
	}
	return status.SeverityWarn
}

// Log builds one page from runs, the stored runs recorded after the cursor
// after, oldest first. The cursor is a run's id.
func Log(runs []history.Run, after, lang string) status.LogPage {
	tr := translator(lang)
	page := status.LogPage{Entries: []status.LogEntry{}, Next: after}
	for _, run := range runs {
		e := status.LogEntry{ID: "run-" + strconv.FormatInt(run.ID, 10), At: run.Finished.UTC(), Level: status.SeverityInfo, Link: "/history"}
		switch {
		case run.Failed():
			e.Level, e.Code = status.SeverityError, "run.failed"
		case run.Skipped > 0:
			e.Level, e.Code = status.SeverityWarn, "run.left"
		case run.Changed():
			e.Code = "run.done"
		default:
			e.Code = "run.quiet"
		}
		e.Text = tr("log."+strings.TrimPrefix(e.Code, "run."), run.Job, run.Skipped)
		page.Entries = append(page.Entries, e)
		page.Next = strconv.FormatInt(run.ID, 10)
	}
	return page
}
