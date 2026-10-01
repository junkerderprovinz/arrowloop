package hook

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRunPassesTheEnvironment(t *testing.T) {
	out := filepath.Join(t.TempDir(), "seen")
	cmd := `echo $ARROWLOOP_JOB > "` + out + `"`
	if runtime.GOOS == "windows" {
		cmd = `echo %ARROWLOOP_JOB%> "` + out + `"`
	}
	if err := Run(context.Background(), cmd, map[string]string{"ARROWLOOP_JOB": "photos"}); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(got)) != "photos" {
		t.Errorf("the command saw %q, want photos", got)
	}
}

func TestRunReportsWhatAFailingCommandSaid(t *testing.T) {
	err := Run(context.Background(), "echo database is busy && exit 3", nil)
	if err == nil {
		t.Fatal("a command that exits 3 passed")
	}
	if !strings.Contains(err.Error(), "database is busy") {
		t.Errorf("the error %q leaves out what the command wrote", err)
	}
}

func TestAnEmptyCommandDoesNothing(t *testing.T) {
	if err := Run(context.Background(), "  ", nil); err != nil {
		t.Errorf("an empty command failed: %v", err)
	}
}

// TestMain lets the test binary stand in for the programs a command starts.
// As a starter it starts a helper that writes to the same output, the way a
// daemon started with & or start /b does, and either stays or leaves. The
// helper waits and then leaves a mark, which shows whether it was stopped.
func TestMain(m *testing.M) {
	switch os.Getenv("HOOK_TEST_ROLE") {
	case "starter":
		helper := exec.Command(os.Args[0])
		helper.Env = append(os.Environ(), "HOOK_TEST_ROLE=helper")
		helper.Stdout = os.Stdout
		helper.Stderr = os.Stderr
		if err := helper.Start(); err != nil {
			os.Exit(2)
		}
		if os.Getenv("HOOK_TEST_STAY") != "" {
			time.Sleep(20 * time.Second)
		}
		os.Exit(0)
	case "helper":
		linger, _ := time.ParseDuration(os.Getenv("HOOK_TEST_LINGER"))
		time.Sleep(linger)
		os.WriteFile(os.Getenv("HOOK_TEST_MARK"), []byte("still here"), 0o644)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// starter is the command that runs this binary as a starter.
func starter() string { return `"` + os.Args[0] + `"` }

func TestATimedOutCommandIsStoppedWithEverythingItStarted(t *testing.T) {
	mark := filepath.Join(t.TempDir(), "mark")
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, starter(), map[string]string{
			"HOOK_TEST_ROLE": "starter", "HOOK_TEST_STAY": "1",
			"HOOK_TEST_LINGER": "3s", "HOOK_TEST_MARK": mark,
		})
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Error("a command stopped by its deadline reported success")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the run was still waiting long after the deadline, held up by what the command started")
	}

	time.Sleep(5 * time.Second)
	if _, err := os.Stat(mark); err == nil {
		t.Error("a process the command started outlived the deadline")
	}
}

// A before command may start a tunnel or a mount helper on purpose, and the
// run goes on while it keeps running.
func TestACommandThatLeavesAHelperRunningStillFinishes(t *testing.T) {
	mark := filepath.Join(t.TempDir(), "mark")
	start := time.Now()
	err := Run(context.Background(), starter(), map[string]string{
		"HOOK_TEST_ROLE": "starter", "HOOK_TEST_LINGER": "10s", "HOOK_TEST_MARK": mark,
	})
	if err != nil {
		t.Fatalf("a command that finished cleanly reported %v", err)
	}
	if took := time.Since(start); took > 7*time.Second {
		t.Errorf("the run waited %s for a helper the command left behind", took.Round(time.Second))
	}

	deadline := time.Now().Add(20 * time.Second)
	for {
		if _, err := os.Stat(mark); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("the helper the command left running was stopped")
		}
		time.Sleep(100 * time.Millisecond)
	}
}
