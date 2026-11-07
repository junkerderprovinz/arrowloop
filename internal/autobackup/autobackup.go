// Package autobackup keeps dated copies of the configuration file in a folder,
// the newest few of them. Each copy is the file byte for byte, the same thing
// the settings export downloads, so the settings import puts it back.
package autobackup

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// A backup is named after the moment it was made, in UTC, so the names sort by
// time and an export saved by hand as arrowloop-2026-11-07.json is never taken
// for one.
const (
	prefix = "arrowloop-auto-"
	stamp  = "20060102-150405"
	ext    = ".json"
	// The leading dot keeps a file still being written out of a file
	// browser's view.
	tempSuffix = ".tmp"
)

// File is one backup in the folder.
type File struct {
	Name  string    `json:"name"`
	Bytes int64     `json:"bytes"`
	Made  time.Time `json:"made"`
}

// Name is the file name of a backup made at t.
func Name(t time.Time) string {
	return prefix + t.UTC().Format(stamp) + ext
}

// ParseName reports when the backup called name was made. Only names Name
// produces pass, which keeps every other file in the folder safe from pruning
// and from a request that names it.
func ParseName(name string) (time.Time, bool) {
	rest, ok := strings.CutPrefix(name, prefix)
	if !ok {
		return time.Time{}, false
	}
	at, ok := strings.CutSuffix(rest, ext)
	if !ok || len(at) != len(stamp) {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation(stamp, at, time.UTC)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// List returns the backups in dir, newest first. A folder that does not exist
// yet holds none.
func List(dir string) ([]File, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read the backup folder %s: %w", dir, err)
	}
	var files []File
	for _, e := range entries {
		made, ok := ParseName(e.Name())
		if !ok || !e.Type().IsRegular() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			// Removed since the folder was read.
			continue
		}
		files = append(files, File{Name: e.Name(), Bytes: info.Size(), Made: made})
	}
	slices.SortFunc(files, func(a, b File) int { return b.Made.Compare(a.Made) })
	return files, nil
}

// Read returns the backup called name in dir.
func Read(dir, name string) ([]byte, error) {
	if _, ok := ParseName(name); !ok {
		return nil, fmt.Errorf("there is no backup called %q", name)
	}
	return os.ReadFile(filepath.Join(dir, name))
}

// Schedule is when backups are due: at Hour:Minute on the day EveryDays days
// after the last one.
type Schedule struct {
	EveryDays    int
	Hour, Minute int
}

// Next is when the next backup is due after the newest of files, or after
// checked when a later look found the file unchanged. The zero time is due at
// once. Days are counted on the calendar in loc, so the time holds when the
// clocks change.
//
// It is read off the files rather than kept anywhere, so an engine that
// restarts every night neither backs up on every start nor never, and days
// missed while it was off add up to one backup, not several.
func Next(files []File, checked time.Time, s Schedule, loc *time.Location) time.Time {
	var last time.Time
	if len(files) > 0 {
		last = files[0].Made
	}
	if checked.After(last) {
		last = checked
	}
	if last.IsZero() {
		return last
	}
	day := last.In(loc)
	return time.Date(day.Year(), day.Month(), day.Day()+s.EveryDays, s.Hour, s.Minute, 0, 0, loc)
}

// Save writes doc into dir as the backup made at now, unless the newest backup
// there already holds the same bytes, and then removes the oldest beyond keep.
// It returns the newest backup and whether it wrote one.
//
// The copy is renamed to its real name only once it is complete and synced, so
// a killed run never leaves a file that looks finished. It carries the
// notification secrets, as the export does, so only this account may read it.
func Save(dir string, doc []byte, now time.Time, keep int) (File, bool, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return File{}, false, fmt.Errorf("make the backup folder %s: %w", dir, err)
	}
	if err := removeTemps(dir); err != nil {
		return File{}, false, err
	}
	files, err := List(dir)
	if err != nil {
		return File{}, false, err
	}
	if len(files) > 0 {
		newest, err := os.ReadFile(filepath.Join(dir, files[0].Name))
		if err == nil && bytes.Equal(newest, doc) {
			return files[0], false, nil
		}
	}

	name := Name(now)
	final := filepath.Join(dir, name)
	tmp := filepath.Join(dir, "."+name+tempSuffix)
	if err := writeSynced(tmp, doc); err != nil {
		os.Remove(tmp)
		return File{}, false, fmt.Errorf("write the backup %s: %w", final, err)
	}
	if err := os.Rename(tmp, final); err != nil {
		os.Remove(tmp)
		return File{}, false, fmt.Errorf("write the backup %s: %w", final, err)
	}
	made, _ := ParseName(name)
	return File{Name: name, Bytes: int64(len(doc)), Made: made}, true, prune(dir, keep)
}

func writeSynced(path string, doc []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, err = f.Write(doc)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}

// removeTemps deletes what an interrupted Save left in dir.
func removeTemps(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read the backup folder %s: %w", dir, err)
	}
	for _, e := range entries {
		n := e.Name()
		if !e.Type().IsRegular() || !strings.HasPrefix(n, "."+prefix) || !strings.HasSuffix(n, tempSuffix) {
			continue
		}
		if err := os.Remove(filepath.Join(dir, n)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("remove the unfinished backup %s: %w", n, err)
		}
	}
	return nil
}

// prune deletes the oldest backups in dir until keep are left. Keeping fewer
// than one would delete the backup just written.
func prune(dir string, keep int) error {
	files, err := List(dir)
	keep = max(keep, 1)
	if err != nil || len(files) <= keep {
		return err
	}
	for _, f := range files[keep:] {
		if err := os.Remove(filepath.Join(dir, f.Name)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("remove the old backup %s: %w", f.Name, err)
		}
	}
	return nil
}

const probeName = ".arrowloop-write-check"

// Writable reports whether backups can be written to dir, by making it and
// writing a probe file into it. Whatever the check made is removed again,
// since the settings save while a path is still being typed; the first backup
// makes the folder for good.
func Writable(dir string) error {
	// Cleaned, or the walk back below would stop short of a folder ".."
	// climbed out of.
	dir = filepath.Clean(dir)
	existing := dir
	for {
		if _, err := os.Stat(existing); err == nil {
			break
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			break
		}
		existing = parent
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("the backup folder %s cannot be made: %w", dir, err)
	}
	defer func() {
		for d := dir; d != existing; d = filepath.Dir(d) {
			os.Remove(d)
		}
	}()
	probe := filepath.Join(dir, probeName)
	if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
		return fmt.Errorf("the backup folder %s cannot be written to: %w", dir, err)
	}
	return os.Remove(probe)
}
