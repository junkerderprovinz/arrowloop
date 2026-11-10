package daemon_test

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

func TestTheExportCarriesTheConfigAndEveryStateDatabase(t *testing.T) {
	var dir string
	cfg, hist, left, _ := fixture(t, func(d, left, right string) string {
		dir = d
		return fmt.Sprintf(`{"jobs":[
			{"name":"photos","left":"%[1]s","right":"%[2]s","state":"state/photos.db","quietPeriod":"0s"},
			{"name":"music","left":"%[1]s","right":"%[2]s","state":"state/music.db","quietPeriod":"0s"}]}`,
			jsonPath(left), jsonPath(right))
	})
	if err := os.WriteFile(filepath.Join(left, "a.jpg"), []byte("abc"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := daemon.New(cfg, hist, nil)
	if _, err := r.Run(context.Background(), "photos"); err != nil {
		t.Fatal(err)
	}

	backup, n, err := r.Export(context.Background(), "the vault")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(backup)
	if err != nil {
		t.Fatal(err)
	}
	if err := backup.Close(); err != nil {
		t.Fatal(err)
	}
	if int64(len(raw)) != n {
		t.Fatalf("the export said %d bytes and held %d", n, len(raw))
	}

	files := map[string][]byte{}
	tr := tar.NewReader(bytes.NewReader(raw))
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		files[h.Name], _ = io.ReadAll(tr)
	}
	if !bytes.Equal(files["arrowloop.json"], cfg.Raw()) {
		t.Errorf("the configuration in the export is %q, want the file as written", files["arrowloop.json"])
	}
	if _, ok := files["state/music.db"]; ok {
		t.Error("a job that never ran brought a database")
	}
	db, ok := files["state/photos.db"]
	if !ok {
		t.Fatalf("the export holds %v, without state/photos.db", keys(files))
	}
	copied := filepath.Join(t.TempDir(), "photos.db")
	if err := os.WriteFile(copied, db, 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := state.Open(context.Background(), copied)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if _, ok, err := st.Get(context.Background(), "a.jpg"); err != nil || !ok {
		t.Errorf("the exported state does not know a.jpg: %v %v", ok, err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".export") {
			t.Errorf("%s is left behind after the export was read", e.Name())
		}
	}
}

func keys(m map[string][]byte) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

func exportStages(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".export-") {
			out = append(out, e.Name())
		}
	}
	return out
}

func TestAStartClearsWhatAnExportLeftBehind(t *testing.T) {
	cfg, hist, _, _ := fixture(t, func(d, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"state/photos.db"}]}`, jsonPath(left), jsonPath(right))
	})
	left := filepath.Join(cfg.Dir(), ".export-123", "backup.tar")
	if err := os.MkdirAll(filepath.Dir(left), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(left, []byte("half a tar"), 0o600); err != nil {
		t.Fatal(err)
	}
	unrelated := filepath.Join(cfg.Dir(), ".exports")
	if err := os.Mkdir(unrelated, 0o755); err != nil {
		t.Fatal(err)
	}

	daemon.New(cfg, hist, nil)
	if got := exportStages(t, cfg.Dir()); len(got) != 0 {
		t.Errorf("after a start %v is still there", got)
	}
	if _, err := os.Stat(unrelated); err != nil {
		t.Errorf("a folder that is no export went too: %v", err)
	}
}

func TestAStartLeavesAnExportThatIsBeingRead(t *testing.T) {
	cfg, hist, _, _ := fixture(t, func(d, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"state/photos.db"}]}`, jsonPath(left), jsonPath(right))
	})
	backup, n, err := daemon.New(cfg, hist, nil).Export(context.Background(), "the vault")
	if err != nil {
		t.Fatal(err)
	}
	var said []string
	daemon.New(cfg, hist, func(format string, args ...any) { said = append(said, fmt.Sprintf(format, args...)) })
	if got := exportStages(t, cfg.Dir()); len(got) != 1 || len(said) != 0 {
		t.Fatalf("a second start left %v of the export being read and said %q", got, said)
	}
	raw, err := io.ReadAll(backup)
	if err != nil || int64(len(raw)) != n {
		t.Fatalf("the export read %d of %d bytes after a second start: %v", len(raw), n, err)
	}
	if err := backup.Close(); err != nil {
		t.Fatal(err)
	}
	if got := exportStages(t, cfg.Dir()); len(got) != 0 {
		t.Errorf("after the export was read %v is still there", got)
	}
}
