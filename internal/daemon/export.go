package daemon

import (
	"archive/tar"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// Export packs this engine's backup for another app to keep: the
// configuration as the automatic backup writes it and a snapshot of every
// job's state database, as a tar staged on disk so its length is known before
// it is sent. Closing it removes the stage, and by names the asker in the log.
func (r *Runner) Export(ctx context.Context, by string) (io.ReadCloser, int64, error) {
	cfg := r.config()
	stage, err := os.MkdirTemp(cfg.Dir(), ".export-")
	if err != nil {
		return nil, 0, fmt.Errorf("stage the export: %w", err)
	}
	f, err := os.Create(filepath.Join(stage, "backup.tar"))
	if err == nil {
		err = pack(ctx, cfg, stage, f)
	}
	var n int64
	if err == nil {
		n, err = f.Seek(0, io.SeekCurrent)
	}
	if err == nil {
		_, err = f.Seek(0, io.SeekStart)
	}
	if err != nil {
		if f != nil {
			f.Close()
		}
		os.RemoveAll(stage)
		return nil, 0, fmt.Errorf("pack the export: %w", err)
	}
	r.log("the backup went to %s, %d bytes", by, n)
	return staged{File: f, dir: stage}, n, nil
}

func pack(ctx context.Context, cfg *job.Config, stage string, w io.Writer) error {
	tw := tar.NewWriter(w)
	name := "arrowloop.json"
	if cfg.Path() != "" {
		name = filepath.Base(cfg.Path())
	}
	raw := cfg.Raw()
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: int64(len(raw)), ModTime: time.Now()}); err != nil {
		return err
	}
	if _, err := tw.Write(raw); err != nil {
		return err
	}
	for i, j := range cfg.Jobs {
		snap := filepath.Join(stage, fmt.Sprint(i)+".db")
		err := state.Snapshot(ctx, j.State, snap)
		if errors.Is(err, fs.ErrNotExist) {
			// A job that never ran has nothing to keep.
			continue
		}
		if err != nil {
			return err
		}
		if err := addFile(tw, entryName(cfg.Dir(), j.State), snap); err != nil {
			return err
		}
	}
	return tw.Close()
}

// entryName is where a state database goes in the export: where it sits
// beside the configuration, or under state/ when it lives elsewhere.
func entryName(dir, path string) string {
	if rel, err := filepath.Rel(dir, path); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return filepath.ToSlash(rel)
	}
	return "state/" + filepath.Base(path)
}

func addFile(tw *tar.Writer, name, path string) error {
	src, err := os.Open(path)
	if err != nil {
		return err
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: info.Size(), ModTime: info.ModTime()}); err != nil {
		return err
	}
	_, err = io.Copy(tw, src)
	return err
}

// staged is an export being read. Closing it removes its folder.
type staged struct {
	*os.File
	dir string
}

func (s staged) Close() error {
	return errors.Join(s.File.Close(), os.RemoveAll(s.dir))
}
