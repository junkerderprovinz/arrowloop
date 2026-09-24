package hook

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
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
