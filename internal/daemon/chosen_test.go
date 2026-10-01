package daemon_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// A preview can stay open for any length of time. A row ticked as a copy must
// not run as a deletion because the source went away in the meantime.
func TestATickedRowThatChangedSinceThePreviewIsLeftAlone(t *testing.T) {
	cfg, hist, left, right := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"docs","left":"%s","right":"%s","state":"%s","quietPeriod":"0s"}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "docs.db")))
	})
	for _, name := range []string{"report.docx", "stays.txt"} {
		if err := os.WriteFile(filepath.Join(left, name), []byte("first"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	r := daemon.New(cfg, hist, nil, nil)
	ctx := context.Background()
	if _, err := r.Run(ctx, "docs"); err != nil {
		t.Fatalf("first run: %v", err)
	}

	if err := os.WriteFile(filepath.Join(left, "report.docx"), []byte("second, and longer"), 0o644); err != nil {
		t.Fatalf("edit: %v", err)
	}
	p, err := r.Preview(ctx, "docs")
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	shown := map[string]plan.Shown{}
	for _, a := range p.Actions {
		shown[a.Path] = a.Show()
	}
	if shown["report.docx"].Kind != "copy" {
		t.Fatalf("the preview does not offer the edit as a copy: %+v", shown)
	}

	if err := os.Remove(filepath.Join(left, "report.docx")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	rec, err := r.RunChosen(ctx, "docs", []string{"report.docx"}, shown, nil)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if _, err := os.Stat(filepath.Join(right, "report.docx")); err != nil {
		t.Fatalf("a row ticked as a copy deleted the file on the right: %v", err)
	}
	if rec.Trashed != 0 || rec.Copied != 0 {
		t.Errorf("the run did something with the changed row: %+v", rec)
	}
}
