package daemon

import (
	"archive/tar"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/dbfile"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// ErrBadBackup and ErrBusy are why Import turns a backup away.
var (
	ErrBadBackup = errors.New("this is not a whole backup of an ArrowLoop configuration")
	ErrBusy      = errors.New("a job is running, so the backup cannot go back now")
)

// reserveName is where Import keeps what it replaced, beside the
// configuration, in the form Export writes.
const reserveName = "before-import.tar"

// Import puts back a backup Export made, once all n bytes of it are read to
// the end and its configuration holds: until then it changes nothing. What it
// replaces stays as before-import.tar, no job runs meanwhile, and by names the
// sender in the log.
func (r *Runner) Import(ctx context.Context, backup io.Reader, n int64, by string) error {
	cfg := r.config()
	stage, err := liveStages.make(cfg.Dir())
	if err != nil {
		return fmt.Errorf("stage the import: %w", err)
	}
	defer liveStages.remove(stage)

	files, err := receive(backup, n, stage)
	if err != nil {
		return err
	}
	name := configName(cfg)
	staged, ok := files[name]
	if !ok {
		return fmt.Errorf("%w: it holds no %s", ErrBadBackup, name)
	}
	doc, err := os.ReadFile(staged)
	if err != nil {
		return err
	}
	checked, err := job.Load(staged)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrBadBackup, err)
	}

	names := jobNames(cfg, checked)
	if !r.claimAll(names) {
		return ErrBusy
	}
	defer r.releaseAll(names)

	if err := keepReserve(ctx, cfg); err != nil {
		return err
	}
	_ = r.BackUp(time.Now())
	next, err := cfg.Replace(doc)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrBadBackup, err)
	}
	moved, err := placeDatabases(next, files)
	if err != nil {
		moved.undo()
		if back, rerr := next.Replace(cfg.Raw()); rerr == nil {
			r.Reload(back)
		}
		return err
	}
	moved.done()
	r.Reload(next)
	r.log("put back the backup from %s: %d jobs", by, len(next.Jobs))
	return nil
}

func configName(cfg *job.Config) string {
	if cfg.Path() != "" {
		return filepath.Base(cfg.Path())
	}
	return "arrowloop.json"
}

// receive reads the backup to its end into the stage and unpacks it there.
// It returns where each file of the backup was put, by its name in the tar.
func receive(backup io.Reader, n int64, stage string) (map[string]string, error) {
	tarPath := filepath.Join(stage, "backup.tar")
	f, err := os.Create(tarPath)
	if err != nil {
		return nil, fmt.Errorf("stage the import: %w", err)
	}
	defer f.Close()
	// One byte past n, so that the read reaches the end, which is where a
	// damaged stream says so.
	got, err := io.Copy(f, io.LimitReader(backup, n+1))
	switch {
	case err != nil:
		return nil, err
	case got != n:
		return nil, fmt.Errorf("%w: it said %d bytes and brought %d", ErrBadBackup, n, got)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}

	files := map[string]string{}
	tr := tar.NewReader(f)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrBadBackup, err)
		}
		if h.Typeflag != tar.TypeReg || !local(h.Name) {
			continue
		}
		// Under the name it had, so that the configuration finds its state
		// paths inside the stage when it is checked.
		dest := filepath.Join(stage, "files", filepath.FromSlash(h.Name))
		if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
			return nil, err
		}
		out, err := os.Create(dest)
		if err != nil {
			return nil, err
		}
		_, err = io.Copy(out, tr)
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrBadBackup, err)
		}
		files[h.Name] = dest
	}
	return files, nil
}

// local reports whether a name in the tar stays inside the folder it is
// unpacked in.
func local(name string) bool {
	return name != "" && !path.IsAbs(name) && path.Clean(name) == name && name != ".." && !strings.HasPrefix(name, "../")
}

// jobNames are the jobs of both configurations, which the import holds.
func jobNames(configs ...*job.Config) []string {
	seen := map[string]bool{}
	var out []string
	for _, c := range configs {
		for _, j := range c.Jobs {
			if !seen[j.Name] {
				seen[j.Name] = true
				out = append(out, j.Name)
			}
		}
	}
	return out
}

func (r *Runner) claimAll(names []string) bool {
	for i, name := range names {
		if !r.claim(name, func() {}) {
			r.releaseAll(names[:i])
			return false
		}
	}
	return true
}

func (r *Runner) releaseAll(names []string) {
	for _, name := range names {
		r.release(name)
	}
}

// keepReserve writes what the configuration and the state databases hold now
// beside the configuration.
func keepReserve(ctx context.Context, cfg *job.Config) error {
	stage, err := liveStages.make(cfg.Dir())
	if err != nil {
		return fmt.Errorf("keep what the import replaces: %w", err)
	}
	defer liveStages.remove(stage)
	tmp := filepath.Join(stage, reserveName)
	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("keep what the import replaces: %w", err)
	}
	err = pack(ctx, cfg, stage, f)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, filepath.Join(cfg.Dir(), reserveName))
	}
	if err != nil {
		return fmt.Errorf("keep what the import replaces: %w", err)
	}
	return nil
}

// moves are the databases placeDatabases set aside, to be put back or
// dropped.
type moves []string

func (m moves) undo() {
	for i := len(m) - 1; i >= 0; i-- {
		os.Remove(m[i])
		os.Rename(m[i]+".before-import", m[i])
	}
}

func (m moves) done() {
	for _, p := range m {
		os.Remove(p + ".before-import")
	}
}

// placeDatabases puts the state database of every job of next in place from
// files, and sets aside the one that was there with its write-ahead log, which
// SQLite would otherwise replay into the new one. A job without a database in
// the backup starts without one, as it did when the backup was made.
func placeDatabases(next *job.Config, files map[string]string) (moves, error) {
	var moved moves
	for _, j := range next.Jobs {
		for _, p := range []string{j.State, j.State + "-wal", j.State + "-shm"} {
			if _, err := os.Stat(p); err != nil {
				continue
			}
			if err := os.Rename(p, p+".before-import"); err != nil {
				return moved, fmt.Errorf("set aside %s: %w", p, err)
			}
			moved = append(moved, p)
		}
		src, ok := files[entryName(next.Dir(), j.State)]
		if !ok {
			continue
		}
		if err := dbfile.EnsureDir(j.State); err != nil {
			return moved, err
		}
		if err := copyInto(src, j.State); err != nil {
			return moved, err
		}
		if !slices.Contains(moved, j.State) {
			moved = append(moved, j.State)
		}
	}
	return moved, nil
}

// copyInto writes src over dest through a file beside dest, so that dest is
// either whole or not there.
func copyInto(src, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dest + ".importing"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, dest)
	}
	if err != nil {
		os.Remove(tmp)
		return fmt.Errorf("put back %s: %w", dest, err)
	}
	return nil
}
