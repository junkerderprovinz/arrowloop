package daemon_test

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// exported is the runner's backup as another app would hold it.
func exported(t *testing.T, r *daemon.Runner) []byte {
	t.Helper()
	backup, _, err := r.Export(context.Background(), "the vault")
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	raw, err := io.ReadAll(backup)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func knows(t *testing.T, path, file string) bool {
	t.Helper()
	db, err := state.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, ok, err := db.Get(context.Background(), file)
	if err != nil {
		t.Fatal(err)
	}
	return ok
}

func jobNames(c *job.Config) []string {
	var out []string
	for _, j := range c.Jobs {
		out = append(out, j.Name)
	}
	return out
}

// imported sets up an engine that ran photos once, takes its backup, and then
// moves on: a second file synced and a second job added.
func imported(t *testing.T) (r *daemon.Runner, backup []byte, dir string) {
	t.Helper()
	cfg, hist, left, right := fixture(t, func(d, left, right string) string {
		dir = d
		return fmt.Sprintf(`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"state/photos.db","quietPeriod":"0s"}]}`, jsonPath(left), jsonPath(right))
	})
	if err := os.WriteFile(filepath.Join(left, "a.jpg"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	r = daemon.New(cfg, hist, nil)
	if _, err := r.Run(context.Background(), "photos"); err != nil {
		t.Fatal(err)
	}
	backup = exported(t, r)

	if err := os.WriteFile(filepath.Join(left, "b.jpg"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Run(context.Background(), "photos"); err != nil {
		t.Fatal(err)
	}
	next, err := r.Config().Replace([]byte(fmt.Sprintf(`{"jobs":[
		{"name":"photos","left":"%[1]s","right":"%[2]s","state":"state/photos.db","quietPeriod":"0s"},
		{"name":"music","left":"%[1]s","right":"%[2]s","state":"state/music.db"}]}`, jsonPath(left), jsonPath(right))))
	if err != nil {
		t.Fatal(err)
	}
	r.Reload(next)
	return r, backup, dir
}

func TestAnImportPutsTheConfigurationAndTheStateDatabasesBack(t *testing.T) {
	r, backup, dir := imported(t)
	if err := r.Import(context.Background(), bytes.NewReader(backup), int64(len(backup)), "the vault"); err != nil {
		t.Fatal(err)
	}

	if got := jobNames(r.Config()); len(got) != 1 || got[0] != "photos" {
		t.Errorf("after the import the jobs are %v, want photos alone", got)
	}
	onDisk, err := job.Load(filepath.Join(dir, "arrowloop.json"))
	if err != nil || len(onDisk.Jobs) != 1 {
		t.Errorf("the configuration file holds %v, %v", onDisk, err)
	}
	photos := filepath.Join(dir, "state", "photos.db")
	if !knows(t, photos, "a.jpg") || knows(t, photos, "b.jpg") {
		t.Error("the state of photos is not the one in the backup")
	}

	reserve, err := os.ReadFile(filepath.Join(dir, "before-import.tar"))
	if err != nil {
		t.Fatalf("no reserve of what the import replaced: %v", err)
	}
	files := map[string][]byte{}
	tr := tar.NewReader(bytes.NewReader(reserve))
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
	if !bytes.Contains(files["arrowloop.json"], []byte(`"music"`)) {
		t.Errorf("the reserve holds the configuration %q, want the one with music", files["arrowloop.json"])
	}
	if _, ok := files["state/photos.db"]; !ok {
		t.Errorf("the reserve holds %v, without the state of photos", keys(files))
	}
	for _, name := range leftovers(t, dir) {
		t.Errorf("%s is left behind", name)
	}
}

// leftovers are the staging folders and set-aside files an import must not
// leave.
func leftovers(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if len(name) > 8 && name[:8] == ".export-" || filepath.Ext(name) == ".before-import" || filepath.Ext(name) == ".importing" {
			out = append(out, p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// brokenAt reads like the backup up to at bytes and then fails, as a damaged
// stream does.
type brokenAt struct {
	r  io.Reader
	at int
}

var errBroken = errors.New("the stream broke")

func (b *brokenAt) Read(p []byte) (int, error) {
	if b.at <= 0 {
		return 0, errBroken
	}
	if len(p) > b.at {
		p = p[:b.at]
	}
	n, err := b.r.Read(p)
	b.at -= n
	return n, err
}

func tarOf(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	for name, body := range files {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: int64(len(body))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestAnImportThatIsNotWholeOrNotABackupChangesNothing(t *testing.T) {
	r, backup, dir := imported(t)
	before, err := os.ReadFile(filepath.Join(dir, "arrowloop.json"))
	if err != nil {
		t.Fatal(err)
	}
	photos := filepath.Join(dir, "state", "photos.db")

	for what, c := range map[string]struct {
		r    io.Reader
		n    int
		want error
	}{
		"broken at the end":      {&brokenAt{r: bytes.NewReader(backup), at: len(backup)}, len(backup), errBroken},
		"broken halfway":         {&brokenAt{r: bytes.NewReader(backup), at: len(backup) / 2}, len(backup), errBroken},
		"shorter than said":      {bytes.NewReader(backup[:len(backup)-10]), len(backup), daemon.ErrBadBackup},
		"longer than said":       {bytes.NewReader(append(append([]byte{}, backup...), 0)), len(backup), daemon.ErrBadBackup},
		"no tar":                 {bytes.NewReader([]byte("hello")), 5, daemon.ErrBadBackup},
		"no configuration":       {bytes.NewReader(tarOf(t, map[string]string{"state/photos.db": "x"})), len(tarOf(t, map[string]string{"state/photos.db": "x"})), daemon.ErrBadBackup},
		"a broken configuration": {bytes.NewReader(tarOf(t, map[string]string{"arrowloop.json": `{"jobs":[{"name":"x"}]}`})), len(tarOf(t, map[string]string{"arrowloop.json": `{"jobs":[{"name":"x"}]}`})), daemon.ErrBadBackup},
	} {
		err := r.Import(context.Background(), c.r, int64(c.n), "the vault")
		if !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", what, err, c.want)
		}
		after, _ := os.ReadFile(filepath.Join(dir, "arrowloop.json"))
		if !bytes.Equal(after, before) || len(r.Config().Jobs) != 2 {
			t.Errorf("%s changed the configuration", what)
		}
		if !knows(t, photos, "b.jpg") {
			t.Errorf("%s changed the state of photos", what)
		}
		if _, err := os.Stat(filepath.Join(dir, "before-import.tar")); err == nil {
			t.Errorf("%s left a reserve, though nothing was replaced", what)
		}
		for _, name := range leftovers(t, dir) {
			t.Errorf("%s left %s behind", what, name)
		}
	}
}

func TestAnImportLeavesNoOldWriteAheadLogToReplay(t *testing.T) {
	r, backup, dir := imported(t)
	photos := filepath.Join(dir, "state", "photos.db")

	// photos left the configuration, and a run of it that was killed left
	// its write-ahead log beside the database.
	music := r.Config().Jobs[1]
	next, err := r.Config().Replace([]byte(fmt.Sprintf(`{"jobs":[{"name":"music","left":"%s","right":"%s","state":"state/music.db"}]}`, jsonPath(music.Left), jsonPath(music.Right))))
	if err != nil {
		t.Fatal(err)
	}
	r.Reload(next)
	db, err := state.Open(context.Background(), photos)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Keep(context.Background(), "c.jpg", time.Unix(1700000000, 0)); err != nil {
		t.Fatal(err)
	}
	wal, err := os.ReadFile(photos + "-wal")
	if err != nil {
		db.Close()
		t.Skipf("no write-ahead log to copy: %v", err)
	}
	db.Close()
	if err := os.WriteFile(photos+"-wal", wal, 0o644); err != nil {
		t.Fatal(err)
	}

	if err := r.Import(context.Background(), bytes.NewReader(backup), int64(len(backup)), "the vault"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(photos + "-wal"); err == nil {
		t.Error("the old write-ahead log is still beside the imported database")
	}
	if !knows(t, photos, "a.jpg") || knows(t, photos, "b.jpg") {
		t.Error("the imported state of photos is not the one in the backup")
	}
}
