package job_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// Emptying a shared list must never widen a job that takes its files from
// that list alone, or a move job would carry off the whole folder.
func TestAJobWhoseOnlyIncludeListIsEmptyTakesNoFiles(t *testing.T) {
	cfg := write(t, `{
		"excludeSets": {"Photos": []},
		"jobs": [{"name":"x","includeSets":["Photos"],`+sides+`}]
	}`)
	j := cfg.Jobs[0]

	opt, err := j.Options()
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	for _, rel := range []string{"photo.jpg", "DCIM/clip.mp4", "notes.txt"} {
		if !opt.Exclude.Excluded(rel) {
			t.Errorf("%s is taken by a job whose only include list is empty", rel)
		}
	}
	if !j.IncludesNothing() {
		t.Error("the job does not say that it takes no files")
	}
}

func TestAnIncludeListNarrowsTheJob(t *testing.T) {
	cfg := write(t, `{
		"excludeSets": {"Photos": ["*.jpg", "*.heic"]},
		"jobs": [{"name":"x","includeSets":["Photos"],`+sides+`}]
	}`)
	opt, err := cfg.Jobs[0].Options()
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	if opt.Exclude.Excluded("DCIM/a.jpg") {
		t.Error("a photo is kept out of a job that includes the photo list")
	}
	if !opt.Exclude.Excluded("DCIM/clip.mp4") {
		t.Error("a video is taken by a job that includes only the photo list")
	}
	if cfg.Jobs[0].IncludesNothing() {
		t.Error("a job with patterns to include says it takes no files")
	}
}

func TestAnIncludeListAddsToTheJobsOwnInclusions(t *testing.T) {
	cfg := write(t, `{
		"excludeSets": {"Photos": ["*.jpg"]},
		"jobs": [{"name":"x","include":["*.pdf"],"includeSets":["Photos"],`+sides+`}]
	}`)
	opt, err := cfg.Jobs[0].Options()
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	for _, rel := range []string{"a.jpg", "b.pdf"} {
		if opt.Exclude.Excluded(rel) {
			t.Errorf("%s is kept out, though the job's own patterns or its list include it", rel)
		}
	}
}

func TestAnEmptyIncludeListBesideOwnInclusionsLeavesThemWorking(t *testing.T) {
	cfg := write(t, `{
		"excludeSets": {"Photos": []},
		"jobs": [{"name":"x","include":["*.pdf"],"includeSets":["Photos"],`+sides+`}]
	}`)
	opt, err := cfg.Jobs[0].Options()
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	if opt.Exclude.Excluded("b.pdf") {
		t.Error("the job's own inclusion stopped working beside an empty list")
	}
	if !opt.Exclude.Excluded("a.jpg") {
		t.Error("the job took a file nothing includes")
	}
	if cfg.Jobs[0].IncludesNothing() {
		t.Error("a job with its own inclusions says it takes no files")
	}
}

func TestAnIncludeListNobodyDefinedIsRefused(t *testing.T) {
	_, err := load(t, `{
		"excludeSets": {"Photos": ["*.jpg"]},
		"jobs": [{"name":"x","includeSets":["Fotos"],`+sides+`}]
	}`)
	if err == nil {
		t.Fatal("a job including a list that does not exist was accepted")
	}
	if !strings.Contains(err.Error(), "Fotos") {
		t.Errorf("the refusal does not name the missing list: %v", err)
	}
}

func TestAListBothIncludedAndExcludedRefusesTheJob(t *testing.T) {
	cfg := write(t, `{
		"excludeSets": {"Photos": ["*.jpg"]},
		"jobs": [{"name":"x","includeSets":["Photos"],"excludeSets":["Photos"],`+sides+`}]
	}`)
	err := cfg.Jobs[0].Refused()
	if err == nil {
		t.Fatal("a job that includes and excludes the same list is not refused")
	}
	if !strings.Contains(err.Error(), "Photos") {
		t.Errorf("the refusal does not name the list: %v", err)
	}
}

// load is write without the fatal, for a configuration that should fail.
func load(t *testing.T, body string) (*job.Config, error) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "arrowloop.json")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	return job.Load(path)
}
