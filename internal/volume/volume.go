// Package volume finds a removable drive or a network share again after it has
// moved.
//
// A drive letter is not an identity: a USB disk that was D: last week may come
// back as E:, and D: may then be another disk, which a job would sync against
// without failing. The identity here is a marker file on the volume rather than
// a serial number or filesystem UUID, because a marker works the same on every
// system and over SMB, and survives a letter change.
package volume

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Prefix is what a job path starts with to mean "on this volume, wherever it
// is today": volume:<id>/some/folder.
const Prefix = "volume:"

// markerPath is where the identity lives, relative to the volume root. The
// engine skips that directory, so a marker never travels to the other side.
const markerPath = ".arrowloop/volume.json"

// legacyMarkerPath is where drives marked by older builds carry their
// identity. Without reading it, such a drive would count as not attached while
// plugged in.
const legacyMarkerPath = ".reeveroll/volume.json"

// Marker is what is written on the volume.
type Marker struct {
	ID    string    `json:"id"`
	Label string    `json:"label"`
	Since time.Time `json:"since"`
}

// Volume is a marked drive that is attached right now.
type Volume struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Mount string `json:"mount"`
}

// ErrNotAttached says a volume is known but not currently here. A job whose
// drive is unplugged is postponed rather than failed.
var ErrNotAttached = errors.New("that volume is not attached")

// Mark writes an identity onto a volume, or returns the one already there, so
// marking a disk twice does not give it a second identity.
func Mark(mount, label string) (Marker, error) {
	if existing, from, err := readMarkerFrom(mount); err == nil {
		relabel := label != "" && label != existing.Label
		if relabel {
			existing.Label = label
		}
		// A marker found at the old path is copied to the current one. The old
		// file stays for older builds on other machines.
		if relabel || from != markerPath {
			if err := writeMarker(mount, existing); err != nil {
				return Marker{}, err
			}
		}
		return existing, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return Marker{}, err
	}

	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return Marker{}, fmt.Errorf("make an identity: %w", err)
	}
	m := Marker{ID: hex.EncodeToString(raw), Label: label, Since: time.Now().UTC()}
	if m.Label == "" {
		m.Label = filepath.Clean(mount)
	}
	if err := writeMarker(mount, m); err != nil {
		return Marker{}, err
	}
	return m, nil
}

func writeMarker(mount string, m Marker) error {
	full := filepath.Join(mount, filepath.FromSlash(markerPath))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return fmt.Errorf("prepare %s: %w", filepath.Dir(full), err)
	}
	body, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(full, append(body, '\n'), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", full, err)
	}
	return nil
}

func readMarker(mount string) (Marker, error) {
	m, _, err := readMarkerFrom(mount)
	return m, err
}

// readMarkerFrom also reports which path answered, so Mark can move an old
// marker to the current path. When neither exists it returns the error for the
// current path.
func readMarkerFrom(mount string) (Marker, string, error) {
	var first error
	for _, rel := range [...]string{markerPath, legacyMarkerPath} {
		body, err := os.ReadFile(filepath.Join(mount, filepath.FromSlash(rel)))
		if err != nil {
			if first == nil {
				first = err
			}
			continue
		}
		var m Marker
		if err := json.Unmarshal(body, &m); err != nil {
			return Marker{}, rel, fmt.Errorf("read the marker on %s: %w", mount, err)
		}
		if m.ID == "" {
			return Marker{}, rel, fmt.Errorf("the marker on %s carries no identity", mount)
		}
		return m, rel, nil
	}
	return Marker{}, "", first
}

// Candidates lists the mount points a marked volume could be sitting on. It is
// a variable so tests can point it at their own directories.
var Candidates = platformCandidates

// Attached lists every marked volume that is here right now.
func Attached() []Volume {
	var out []Volume
	seen := map[string]bool{}
	for _, mount := range Candidates() {
		m, err := readMarker(mount)
		if err != nil || seen[m.ID] {
			continue
		}
		seen[m.ID] = true
		v := Volume{ID: m.ID, Label: m.Label, Mount: mount}
		remember(v)
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	return out
}

// Find locates a volume by its identity.
func Find(id string) (Volume, error) {
	for _, v := range Attached() {
		if v.ID == id {
			return v, nil
		}
	}
	return Volume{}, fmt.Errorf("%w: %s", ErrNotAttached, id)
}

// Resolve turns a job path into a real one. A path without the prefix is
// returned unchanged.
func Resolve(path string) (string, error) {
	if !strings.HasPrefix(path, Prefix) {
		return path, nil
	}
	rest := strings.TrimPrefix(path, Prefix)
	id, sub, _ := strings.Cut(rest, "/")
	if id == "" {
		return "", fmt.Errorf("a volume path needs an identity: %s", path)
	}

	v, err := Find(id)
	if err != nil {
		return "", err
	}
	if sub == "" {
		return v.Mount, nil
	}
	return filepath.Join(v.Mount, filepath.FromSlash(sub)), nil
}

// Describe renders a volume path for a person, using the label the volume
// carries rather than the identity nobody can read.
func Describe(path string) string {
	if !strings.HasPrefix(path, Prefix) {
		return path
	}
	rest := strings.TrimPrefix(path, Prefix)
	id, sub, _ := strings.Cut(rest, "/")
	// The drive is asked first, because a changed label reaches the disk
	// before the register.
	var label string
	if v, err := Find(id); err == nil {
		label = v.Label
	} else {
		label = labelFor(id)
	}
	if sub == "" {
		return label
	}
	return label + "/" + sub
}
