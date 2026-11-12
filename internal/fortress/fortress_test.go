package fortress

import (
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/status"

	"github.com/junkerderprovinz/arrowloop/internal/anomaly"
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

var now = time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)

func snapshot() Snapshot {
	return Snapshot{
		Jobs: []job.Job{
			{Name: "Fotos", Mode: "mirror", Schedule: "0 3 * * *"},
			{Name: "Musik", Schedule: "@every 1h"},
			{Name: "Alt", Disabled: true, Schedule: "0 4 * * *"},
		},
		Now: now,
	}
}

func needFor(t *testing.T, r status.Report, code string) status.Need {
	t.Helper()
	for _, n := range r.NeedsYou {
		if n.Code == code {
			return n
		}
	}
	t.Fatalf("no need with code %s in %+v", code, r.NeedsYou)
	return status.Need{}
}

func TestAHeldJobNeedsYouInTheReadersLanguage(t *testing.T) {
	s := snapshot()
	s.Findings = []anomaly.Finding{{ID: "f1", Job: "Fotos", Kind: anomaly.Delete, Held: true, Count: 812, Since: now.Add(-time.Hour)}}

	en := needFor(t, Report(s, "en"), "job.held")
	de := needFor(t, Report(s, "de"), "job.held")
	if en.ID != de.ID || en.ID == "" {
		t.Errorf("the ids differ between languages: %q and %q", en.ID, de.ID)
	}
	if en.Text == de.Text || !strings.Contains(en.Text, "Fotos") || !strings.Contains(en.Text, "812") {
		t.Errorf("the texts are %q and %q", en.Text, de.Text)
	}
	if en.Severity != status.SeverityWarn || !en.Since.Equal(now.Add(-time.Hour)) || en.Link != "/anomalies" {
		t.Errorf("the held job reads %+v", en)
	}
}

func TestABrakeAgainstOverwritingIsAnError(t *testing.T) {
	s := snapshot()
	s.Findings = []anomaly.Finding{{ID: "f1", Job: "Fotos", Kind: anomaly.Change, Held: true, Count: 40}}
	if n := needFor(t, Report(s, "en"), "job.held"); n.Severity != status.SeverityError {
		t.Errorf("files overwritten in bulk read as %s", n.Severity)
	}
}

func TestFilesLeftForLaterNeedYou(t *testing.T) {
	s := snapshot()
	s.Latest = []history.Run{{ID: 7, Job: "Musik", Skipped: 3, Finished: now.Add(-time.Minute)}}
	n := needFor(t, Report(s, "en"), "job.left")
	if n.Severity != status.SeverityWarn || !strings.Contains(n.Text, "3") || n.Link != "/history" {
		t.Errorf("files left for later read as %+v", n)
	}
}

func TestAFailedLastRunNeedsYouUnlessAFindingSaysMore(t *testing.T) {
	s := snapshot()
	s.Latest = []history.Run{{ID: 7, Job: "Musik", Err: "dial tcp: refused"}, {ID: 8, Job: "Fotos", Err: "held"}}
	s.Findings = []anomaly.Finding{{ID: "f1", Job: "Fotos", Kind: anomaly.Empty, Held: true}}

	r := Report(s, "en")
	if n := needFor(t, r, "job.failed"); n.Severity != status.SeverityError || !strings.Contains(n.Text, "Musik") {
		t.Errorf("the failed run reads %+v", n)
	}
	for _, n := range r.NeedsYou {
		if n.Code == "job.failed" && strings.Contains(n.Text, "Fotos") {
			t.Errorf("a held job is also reported as failed: %+v", n)
		}
	}
}

func TestRunsOfJobsThatAreGoneNeedNobody(t *testing.T) {
	s := snapshot()
	s.Latest = []history.Run{{ID: 7, Job: "Gelöscht", Err: "boom"}, {ID: 8, Job: "Alt", Skipped: 2}}
	if r := Report(s, "en"); len(r.NeedsYou) != 0 {
		t.Errorf("deleted and disabled jobs need you: %+v", r.NeedsYou)
	}
}

func TestEveryKindOfFindingHasAText(t *testing.T) {
	for _, kind := range []anomaly.Kind{anomaly.Delete, anomaly.Change, anomaly.Empty, anomaly.Failing, anomaly.Overdue, anomaly.Unusual} {
		s := snapshot()
		s.Findings = []anomaly.Finding{{ID: "f", Job: "Fotos", Kind: kind, Held: kind.Holds(), Count: 4}}
		r := Report(s, "de")
		if len(r.NeedsYou) != 1 || r.NeedsYou[0].Text == "" || strings.Contains(r.NeedsYou[0].Text, "{") {
			t.Errorf("%s reads %+v", kind, r.NeedsYou)
		}
	}
}

func TestAnOverdueJobMakesTheAppOverdue(t *testing.T) {
	s := snapshot()
	if r := Report(s, "en"); r.State != status.StateOK {
		t.Errorf("an app with nothing open is %s", r.State)
	}
	s.Findings = []anomaly.Finding{{ID: "f", Job: "Musik", Kind: anomaly.Overdue, Count: 3}}
	if r := Report(s, "en"); r.State != status.StateOverdue {
		t.Errorf("an app with an overdue job is %s", r.State)
	}
}

func TestAnAppWithoutAnEnabledJobIsOff(t *testing.T) {
	s := snapshot()
	s.Jobs = s.Jobs[2:]
	if r := Report(s, "en"); r.State != status.StateOff {
		t.Errorf("an app whose only job is disabled is %s", r.State)
	}
}

func TestARunningJobIsWorkWithItsProgress(t *testing.T) {
	s := snapshot()
	started := now.Add(-time.Minute)
	s.Working = []daemon.Working{{Job: "Fotos", Started: started, Done: 3, Total: 12}, {Job: "Musik", Started: started}}

	r := Report(s, "en")
	if len(r.Work) != 2 {
		t.Fatalf("work is %+v", r.Work)
	}
	fotos, musik := r.Work[0], r.Work[1]
	if fotos.Title != "Fotos" || fotos.Kind != status.KindSync || !fotos.StartedAt.Equal(started) || fotos.Progress == nil || *fotos.Progress != 0.25 {
		t.Errorf("the mirror job runs as %+v", fotos)
	}
	if !fotos.BlocksRestart || musik.BlocksRestart {
		t.Errorf("a mirror blocks a restart %v, a sync %v", fotos.BlocksRestart, musik.BlocksRestart)
	}
	if musik.Progress != nil {
		t.Errorf("a job still reading its sides claims progress %v", *musik.Progress)
	}
	if again := Report(s, "en"); again.Work[0].ID != fotos.ID || fotos.ID == musik.ID {
		t.Errorf("the ids are %q, %q and then %q", fotos.ID, musik.ID, again.Work[0].ID)
	}
}

func TestNextListsTheScheduledJobsSoonestFirst(t *testing.T) {
	r := Report(snapshot(), "en")
	if len(r.Next) != 2 {
		t.Fatalf("next is %+v", r.Next)
	}
	if r.Next[0].Title != "Musik" || !r.Next[0].At.Equal(now.Add(time.Hour)) || r.Next[1].Title != "Fotos" {
		t.Errorf("next is %+v", r.Next)
	}
}

func TestTheLogNamesEveryRunByItsOutcome(t *testing.T) {
	runs := []history.Run{
		{ID: 4, Job: "Fotos", Copied: 2, Finished: now},
		{ID: 5, Job: "Fotos", Unchanged: 9, Finished: now.Add(time.Minute)},
		{ID: 6, Job: "Musik", Skipped: 1, Finished: now.Add(2 * time.Minute)},
		{ID: 9, Job: "Musik", Err: "refused", Finished: now.Add(3 * time.Minute)},
	}
	page := Log(runs, nil, "3", "en", 50)
	want := []struct {
		code  string
		level status.Severity
	}{{"run.done", status.SeverityInfo}, {"run.quiet", status.SeverityInfo}, {"run.left", status.SeverityWarn}, {"run.failed", status.SeverityError}}
	if len(page.Entries) != len(want) || page.Next != "9" {
		t.Fatalf("the page is %+v", page)
	}
	de := Log(runs, nil, "3", "de", 50)
	for i, w := range want {
		e := page.Entries[i]
		if e.Code != w.code || e.Level != w.level || e.Link != "/history" || e.Text == de.Entries[i].Text {
			t.Errorf("entry %d is %+v, in German %q", i, e, de.Entries[i].Text)
		}
	}
	if page.Entries[0].ID != "run-4" || !page.Entries[3].At.Equal(now.Add(3*time.Minute)) {
		t.Errorf("the entries are %+v", page.Entries)
	}
}

func TestAnEmptyLogPageRepeatsTheCursor(t *testing.T) {
	if p := Log(nil, nil, "12", "en", 50); p.Next != "12" || len(p.Entries) != 0 {
		t.Errorf("an empty page is %+v", p)
	}
}

func TestAnOpeningFromAnotherAppTakesItsTurnAmongTheRuns(t *testing.T) {
	runs := []history.Run{
		{ID: 4, Job: "Fotos", Copied: 2, Finished: now},
		{ID: 5, Job: "Musik", Copied: 1, Finished: now.Add(2 * time.Minute)},
	}
	opened := []history.Opening{{ID: 7, At: now.Add(time.Minute), App: "BombVault", Device: "Attic", Member: "0123456789abcdef"}}
	page := Log(runs, opened, "3", "en", 2)
	if len(page.Entries) != 2 || page.Entries[0].ID != "run-4" || page.Entries[1].ID != "opened-7" {
		t.Fatalf("the page is %+v", page.Entries)
	}
	e := page.Entries[1]
	if e.Code != "ui.opened" || e.Level != status.SeverityInfo || !e.At.Equal(now.Add(time.Minute)) {
		t.Errorf("the opening reads %+v", e)
	}
	for _, part := range []string{"BombVault", "Attic", "89abcdef"} {
		if !strings.Contains(e.Text, part) {
			t.Errorf("the opening %q does not name %s", e.Text, part)
		}
	}
	if strings.Contains(e.Text, "01234567") {
		t.Errorf("the opening %q names the whole id", e.Text)
	}
	if run, open := Cursor(page.Next); run != 4 || open != 7 {
		t.Errorf("the cursor %q reads as run %d, opening %d", page.Next, run, open)
	}
	if run, open := Cursor("9"); run != 9 || open != 0 {
		t.Errorf("a cursor from before openings reads as run %d, opening %d", run, open)
	}
	if run, open := Cursor("nonsense"); run != 0 || open != 0 {
		t.Errorf("a cursor this engine never handed out reads as run %d, opening %d", run, open)
	}
}

func TestALanguageIsFoundByItsBaseTag(t *testing.T) {
	s := snapshot()
	s.Latest = []history.Run{{ID: 7, Job: "Musik", Err: "x"}}
	de := needFor(t, Report(s, "de"), "job.failed").Text
	if got := needFor(t, Report(s, "de-AT"), "job.failed").Text; got != de {
		t.Errorf("de-AT reads %q, de %q", got, de)
	}
	en := needFor(t, Report(s, "en"), "job.failed").Text
	for _, lang := range []string{"", "tlh", "x-unknown"} {
		if got := needFor(t, Report(s, lang), "job.failed").Text; got != en {
			t.Errorf("%q reads %q, want the English %q", lang, got, en)
		}
	}
}
