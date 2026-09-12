package job

import (
	"strings"
	"testing"
)

// A field this program used to write is not a typo.
//
// `DisallowUnknownFields` exists so that "excludes" for "exclude" is an error
// rather than a filter that silently does nothing, and that reach is worth
// keeping whole. It also means every field ever REMOVED from this program turns
// an existing installation into a dead engine at the next update: the process
// exits, the container restarts, and the only message is one line of JSON
// complaint that says nothing about versions.
//
// Found on jdp's server. A container from the seventh was updated and went into
// a restart loop on `firstRun`, a per-job setting this program had since
// dropped. Nothing had changed on that machine except the version.

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
	// Ignoring it silently would be the other half of the same bug: somebody
	// who set it once should hear that it does nothing now, rather than
	// believing a setting is in force because the file still shows it.
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

// The guard the strictness exists for, unchanged. This is the half that must
// not be traded away for the half above: the retired list is CLOSED, so every
// other unknown word is still a refusal.
func TestAMisspelledFieldIsStillRefused(t *testing.T) {
	_, err := Load(writeConfig(t, `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","emptyDir":true}]}`))
	if err == nil {
		t.Fatal("a misspelled field was accepted, which is the silently-dropped setting this guard exists for")
	}
	if !strings.Contains(err.Error(), "emptyDir") {
		t.Errorf("the refusal does not name the field somebody has to fix: %v", err)
	}
}

// A retired name nested anywhere, not only where it used to live. The cleaner
// walks the whole document because the next retired field might be a top-level
// one, and a cleaner that only looked inside `jobs` would hand that one to the
// strict decoder it is supposed to protect.
func TestARetiredFieldIsFoundAtTheTopLevelToo(t *testing.T) {
	_, err := Load(writeConfig(t, `{"firstRun":"left","jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db"}]}`))
	if err != nil {
		t.Fatalf("a retired field outside a job stopped the load: %v", err)
	}
}
