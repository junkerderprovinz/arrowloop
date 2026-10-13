package history_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

func TestARunSaysWhatKindOfFailureItEndedWith(t *testing.T) {
	run := history.Run{Job: "photos", Err: `left side "nas:photos": dial tcp 192.168.1.20:22: connect: connection refused`}
	out, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `"Failure":{"code":"unreachable","params":{"side":"left"}}`) {
		t.Errorf("the run's JSON names no failure: %s", out)
	}
	var back history.Run
	if err := json.Unmarshal(out, &back); err != nil || back.Err != run.Err || back.Job != run.Job {
		t.Errorf("the run did not come back as it went out: %+v, %v", back, err)
	}
}

func TestARunThatWorkedNamesNoFailure(t *testing.T) {
	out, err := json.Marshal(history.Run{Job: "photos"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), "Failure") {
		t.Errorf("a run without an error carries a failure: %s", out)
	}
}
