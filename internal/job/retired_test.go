package job

import (
	"strings"
	"testing"
)

// A field an earlier version wrote is not a typo, and refusing it would stop
// the engine at the first start after an update.
func TestARetiredFieldDoesNotStopTheEngine(t *testing.T) {
	cfg, err := Load(writeConfig(t, `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","firstRun":"left"}]}`))
	if err != nil {
		t.Fatalf("a configuration this program itself wrote was refused: %v", err)
	}
	if len(cfg.Jobs) != 1 || cfg.Jobs[0].Name != "x" {
		t.Fatalf("the job did not survive the cleaning: %+v", cfg.Jobs)
	}
}

func TestARetiredFieldIsReportedRatherThanSwallowed(t *testing.T) {
	cfg, err := Load(writeConfig(t, `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","firstRun":"left"}]}`))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	// Somebody who set it should hear that it has no effect, rather than
	// believe it is in force because the file still shows it.
	if got := cfg.Retired(); len(got) != 1 || got[0] != "firstRun" {
		t.Errorf("the retired field was dropped without a word: %v", got)
	}
}

func TestAConfigWithNoRetiredFieldSaysNothing(t *testing.T) {
	cfg, err := Load(writeConfig(t, `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db"}]}`))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := cfg.Retired(); len(got) != 0 {
		t.Errorf("an ordinary configuration reported retired fields: %v", got)
	}
}

// The retired list is closed, so every other unknown word is still refused.
func TestAMisspelledFieldIsStillRefused(t *testing.T) {
	_, err := Load(writeConfig(t, `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","emptyDir":true}]}`))
	if err == nil {
		t.Fatal("a misspelled field was accepted, which is the silently-dropped setting this guard exists for")
	}
	if !strings.Contains(err.Error(), "emptyDir") {
		t.Errorf("the refusal does not name the field somebody has to fix: %v", err)
	}
}

// The next retired field might be a top-level one, so the whole document is
// cleaned, not only the jobs.
func TestARetiredFieldIsFoundAtTheTopLevelToo(t *testing.T) {
	_, err := Load(writeConfig(t, `{"firstRun":"left","jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db"}]}`))
	if err != nil {
		t.Fatalf("a retired field outside a job stopped the load: %v", err)
	}
}
