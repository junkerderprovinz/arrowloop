package daemon

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

func TestAnImportWaitsUntilNoJobRuns(t *testing.T) {
	dir := t.TempDir()
	for _, d := range []string{"left", "right"} {
		if err := os.Mkdir(filepath.Join(dir, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(dir, "arrowloop.json")
	doc := `{"jobs":[{"name":"photos","left":"` + filepath.ToSlash(filepath.Join(dir, "left")) + `","right":"` + filepath.ToSlash(filepath.Join(dir, "right")) + `","state":"state/photos.db"}]}`
	if err := os.WriteFile(path, []byte(doc), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := job.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	hist, err := history.Open(context.Background(), filepath.Join(dir, "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer hist.Close()
	r := New(cfg, hist, nil)
	backup, n, err := r.Export(context.Background(), "the vault")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(backup)
	backup.Close()

	if !r.claim("photos", func() {}) {
		t.Fatal("photos was already claimed")
	}
	if err := r.Import(context.Background(), bytes.NewReader(raw), n, "the vault"); !errors.Is(err, ErrBusy) {
		t.Fatalf("an import while photos runs: %v, want ErrBusy", err)
	}
	r.release("photos")
	if err := r.Import(context.Background(), bytes.NewReader(raw), n, "the vault"); err != nil {
		t.Fatalf("an import once photos is done: %v", err)
	}
	r.mu.Lock()
	held := len(r.inflight)
	r.mu.Unlock()
	if held != 0 {
		t.Errorf("the import kept %d jobs claimed", held)
	}
	if entries, _ := os.ReadDir(dir); strings.Contains(listNames(entries), ".export-") {
		t.Errorf("the import left its stage: %s", listNames(entries))
	}
}

func listNames(entries []os.DirEntry) string {
	var b strings.Builder
	for _, e := range entries {
		b.WriteString(e.Name() + " ")
	}
	return b.String()
}
