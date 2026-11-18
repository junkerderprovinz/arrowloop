package job

import (
	"strings"
	"testing"
	"time"
)

func TestAOneWayJobWaitsTheDaysItIsGiven(t *testing.T) {
	cfg, err := Load(writeConfig(t, `{"jobs":[
		{"name":"camera","left":"/a","right":"/b","state":"s.db","direction":"leftToRight","mode":"move","minAgeDays":30}]}`))
	if err != nil {
		t.Fatal(err)
	}
	j, _ := cfg.Find("camera")
	if err := j.Refused(); err != nil {
		t.Fatalf("a one-way job with a minimum age was refused: %v", err)
	}
	opt, err := j.Options()
	if err != nil {
		t.Fatal(err)
	}
	if opt.Compare.MinAge != 30*24*time.Hour {
		t.Errorf("MinAge = %v, want 720h", opt.Compare.MinAge)
	}
}

func TestATwoWayJobIsRefusedAMinimumAge(t *testing.T) {
	cfg, err := Load(writeConfig(t, `{"jobs":[
		{"name":"both","left":"/a","right":"/b","state":"s.db","minAgeDays":7},
		{"name":"plain","left":"/c","right":"/d","state":"t.db"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	j, _ := cfg.Find("both")
	if err := j.Refused(); err == nil || !strings.Contains(err.Error(), "one-way") {
		t.Errorf("a two-way job with a minimum age was not refused: %v", err)
	}
	if plain, _ := cfg.Find("plain"); plain.Refused() != nil {
		t.Errorf("the job beside it was refused too: %v", plain.Refused())
	}
}

func TestLoadRefusesANegativeOrEndlessMinimumAge(t *testing.T) {
	for _, days := range []string{"-1", "100000"} {
		_, err := Load(writeConfig(t, `{"jobs":[
			{"name":"x","left":"/a","right":"/b","state":"s.db","direction":"leftToRight","minAgeDays":`+days+`}]}`))
		if err == nil || !strings.Contains(err.Error(), "minAgeDays") {
			t.Errorf("minAgeDays %s: %v", days, err)
		}
	}
}

func TestZeroDaysSendsEveryFileInAnyDirection(t *testing.T) {
	cfg, err := Load(writeConfig(t, `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","minAgeDays":0}]}`))
	if err != nil {
		t.Fatal(err)
	}
	j, _ := cfg.Find("x")
	if err := j.Refused(); err != nil {
		t.Errorf("zero days was refused in a two-way job: %v", err)
	}
}
