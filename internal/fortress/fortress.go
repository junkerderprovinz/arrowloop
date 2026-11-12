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

// Outcome names how run ended: "failed", "left" when it left files for a
// later run, "done" when it changed something and "quiet" when there was
// nothing to do.
func Outcome(run history.Run) string {
	switch {
	case run.Failed():
		return "failed"
	case run.Skipped > 0:
		return "left"
	case run.Changed():
		return "done"
	}
	return "quiet"
}

// Log builds one page from runs and opened, the stored runs and openings
// recorded after the cursor after, each oldest first. It takes at most limit
// of them in the order they happened; Cursor reads the cursor it hands out.
func Log(runs []history.Run, opened []history.Opening, after, lang string, limit int) status.LogPage {
	tr := translator(lang)
	page := status.LogPage{Entries: []status.LogEntry{}, Next: after}
	run, open := Cursor(after)
	for len(page.Entries) < limit && (len(runs) > 0 || len(opened) > 0) {
		if len(runs) == 0 || len(opened) > 0 && opened[0].At.Before(runs[0].Finished) {
			o := opened[0]
			opened = opened[1:]
			page.Entries = append(page.Entries, status.LogEntry{
				ID: "opened-" + strconv.FormatInt(o.ID, 10), At: o.At.UTC(), Level: status.SeverityInfo, Code: "ui.opened",
				Text: strings.NewReplacer("{app}", o.App, "{device}", o.Device, "{id}", shortID(o.Member)).Replace(tr("log.opened", "", 0)),
			})
			open = o.ID
			continue
		}
		r := runs[0]
		runs = runs[1:]
		outcome := Outcome(r)
		e := status.LogEntry{ID: "run-" + strconv.FormatInt(r.ID, 10), At: r.Finished.UTC(), Level: status.SeverityInfo, Code: "run." + outcome, Link: "/history"}
		switch outcome {
		case "failed":
			e.Level = status.SeverityError
		case "left":
			e.Level = status.SeverityWarn
		}
		e.Text = tr("log."+outcome, r.Job, r.Skipped)
		page.Entries = append(page.Entries, e)
		run = r.ID
	}
	if len(page.Entries) > 0 {
		page.Next = strconv.FormatInt(run, 10)
		if open > 0 {
			page.Next += "." + strconv.FormatInt(open, 10)
		}
	}
	return page
}

// Cursor reads a cursor Log handed out as the last run and the last opening
// it covered. One from before there were openings names a run alone, and one
// this engine never handed out starts at the beginning.
func Cursor(after string) (run, opened int64) {
	r, o, _ := strings.Cut(after, ".")
	run, err := strconv.ParseInt(r, 10, 64)
	if err != nil {
		return 0, 0
	}
	if o != "" {
		if opened, err = strconv.ParseInt(o, 10, 64); err != nil {
			return 0, 0
		}
	}
	return run, opened
}

// shortID is the end of a member's id, as the bar above an opened page shows
// it.
func shortID(id string) string {
	if len(id) > 8 {
		return id[len(id)-8:]
	}
	return id
}
