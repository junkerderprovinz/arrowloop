package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/joblock"
)

// setup writes a configuration holding jobs over a left folder with one file
// in it and returns the options that use it by default.
func setup(t *testing.T, jobs ...map[string]any) (Options, *bytes.Buffer) {
	t.Helper()
	dir := t.TempDir()
	left := filepath.Join(dir, "left")
	if err := os.MkdirAll(left, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(left, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, j := range jobs {
		name := j["name"].(string)
		j["left"] = left
		j["right"] = filepath.Join(dir, "right-"+name)
		j["state"] = filepath.Join(dir, "state", name+".db")
		j["quietPeriod"] = "0s"
		if err := os.MkdirAll(j["right"].(string), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	body, err := json.Marshal(map[string]any{"jobs": jobs})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "arrowloop.json")
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	return Options{
		Config:  path,
		Remotes: func(string) error { return nil },
		Stdout:  &out,
		Stderr:  &bytes.Buffer{},
	}, &out
}

func runs(t *testing.T, o Options, name string) []history.Run {
	t.Helper()
	cfg, err := job.Load(o.Config)
	if err != nil {
		t.Fatal(err)
	}
	hist, err := history.Open(context.Background(), cfg.History)
	if err != nil {
		t.Fatal(err)
	}
	defer hist.Close()
	j, ok := cfg.Find(name)
	if !ok {
		t.Fatalf("no job called %q", name)
	}
	got, err := hist.Recent(context.Background(), j.Key(), history.ShowAll, 10)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestRunDueWithNothingDueSucceedsQuietly(t *testing.T) {
	o, out := setup(t, map[string]any{"name": "photos"})

	if code := Main([]string{"run-due"}, o); code != 0 {
		t.Fatalf("exit %d, want 0", code)
	}
	if out.Len() != 0 {
		t.Errorf("printed %q with nothing due", out)
	}
	if got := runs(t, o, "photos"); len(got) != 0 {
		t.Errorf("a job without a schedule ran: %+v", got)
	}
}

func TestRunDueRunsADueJobAndRecordsIt(t *testing.T) {
	o, out := setup(t, map[string]any{"name": "photos", "schedule": "0 3 * * *"})

	if code := Main([]string{"run-due"}, o); code != 0 {
		t.Fatalf("exit %d, want 0; stderr: %s", code, o.Stderr)
	}
	if !strings.HasPrefix(out.String(), "photos: 1 copied,") || strings.Count(out.String(), "\n") != 1 {
		t.Errorf("printed %q, want one line for photos", out)
	}
	if got := runs(t, o, "photos"); len(got) != 1 || got[0].Failed() {
		t.Errorf("recorded %+v, want one good run", got)
	}

	out.Reset()
	if code := Main([]string{"run-due"}, o); code != 0 || out.Len() != 0 {
		t.Errorf("a second run-due straight after: exit %d, printed %q", code, out)
	}
}

func TestRunDueExitsOneWhenAJobFails(t *testing.T) {
	o, out := setup(t,
		map[string]any{"name": "broken", "schedule": "0 3 * * *", "before": "exit 3"},
		map[string]any{"name": "photos", "schedule": "0 3 * * *"},
	)

	if code := Main([]string{"run-due"}, o); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	if !strings.Contains(out.String(), "broken: failed, ") {
		t.Errorf("printed %q, want the failure named", out)
	}
	if !strings.Contains(out.String(), "photos: 1 copied,") {
		t.Errorf("printed %q, want the other job to run all the same", out)
	}
}

func TestRunDueTakesAVPNJobToItsTunnel(t *testing.T) {
	o, out := setup(t, map[string]any{"name": "photos", "schedule": "0 3 * * *", "vpn": "a1b2c3d4"})

	Main([]string{"run-due"}, o)
	if strings.Contains(out.String(), "no built-in VPN") || !strings.Contains(out.String(), "the VPN did not come up") {
		t.Errorf("printed %q, want the run to fail on the tunnel that is not set up", out)
	}
}

func TestRunDueLeavesAJobAnotherProcessRunsAlone(t *testing.T) {
	o, out := setup(t, map[string]any{"name": "photos", "schedule": "0 3 * * *"})
	cfg, err := job.Load(o.Config)
	if err != nil {
		t.Fatal(err)
	}
	j, _ := cfg.Find("photos")
	release, _, err := joblock.Take(filepath.Dir(j.State), j.Key())
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	if code := Main([]string{"run-due"}, o); code != 0 {
		t.Fatalf("exit %d, want 0", code)
	}
	if want := "photos: skipped, another ArrowLoop is running this job right now\n"; out.String() != want {
		t.Errorf("printed %q, want %q", out, want)
	}
	if got := runs(t, o, "photos"); len(got) != 0 {
		t.Errorf("recorded %+v for a job it left alone", got)
	}
}

func TestRunDueRefusesArguments(t *testing.T) {
	o, _ := setup(t, map[string]any{"name": "photos"})
	if code := Main([]string{"run-due", "photos"}, o); code != 2 {
		t.Errorf("exit %d, want 2", code)
	}
	if code := Main([]string{"run-due", "-no-such-flag"}, o); code != 2 {
		t.Errorf("exit %d for an unknown flag, want 2", code)
	}
}

func TestAStoppedRunDueRecordsTheRunAsStopped(t *testing.T) {
	pause := "sleep 30"
	if runtime.GOOS == "windows" {
		pause = "ping -n 31 127.0.0.1 > nul"
	}
	o, out := setup(t, map[string]any{"name": "photos", "schedule": "0 3 * * *", "before": pause})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	o.Stderr = &onLine{want: "due now", then: func() { time.AfterFunc(500*time.Millisecond, cancel) }}

	if err := o.runDue(ctx, nil); err == nil {
		t.Fatal("a stopped run-due reported success")
	}
	if out.String() != "photos: stopped\n" {
		t.Errorf("printed %q, want photos stopped", out)
	}
	if got := runs(t, o, "photos"); len(got) != 1 || !got[0].Stopped {
		t.Errorf("recorded %+v, want one stopped run", got)
	}
}

func TestAStopBySignalExitsWithTheShellsCode(t *testing.T) {
	if got := (interrupted{syscall.SIGINT}).exitCode(); got != 130 {
		t.Errorf("Ctrl+C: %d, want 130", got)
	}
	if got := (interrupted{syscall.SIGTERM}).exitCode(); got != 143 {
		t.Errorf("SIGTERM: %d, want 143", got)
	}
}

// onLine calls then once, the first time a line containing want is written.
type onLine struct {
	want string
	then func()
	once sync.Once
}

func (w *onLine) Write(p []byte) (int, error) {
	if strings.Contains(string(p), w.want) {
		w.once.Do(w.then)
	}
	return len(p), nil
}
