// Package volume finds a removable drive or a network share again after it has
// moved.
//
// A drive letter is not an identity. A USB disk that was D: last week comes
// back as E: today, and worse, D: may by then belong to something else
// entirely. A job pointed at a letter therefore has two failure modes and the
// second one is the dangerous one: it does not fail, it syncs against the wrong
// disk. A network share has the same problem wearing a different hat, since a
// mapped letter and a UNC path are the same share and neither is stable.
//
// The identity used here is a marker file written on the volume itself, not a
// serial number or a filesystem UUID. That is a deliberate trade. A serial is
// free and needs no write, but reading one means a different platform API on
// every operating system, it does not exist at all for a network share, and it
// changes when somebody reformats. A marker is one small file, works the same
// everywhere including over SMB, survives a drive letter change, and is
// self-describing: anybody who finds it can see what it is for.
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

// markerPath is where the identity lives, relative to the volume root. It sits
// under the same reserved directory the engine already skips when listing, so
// a marker never travels to the other side of a sync.
const markerPath = ".reeveroll/volume.json"

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

// ErrNotAttached says a volume is known but not currently here.
//
// This is deliberately its own error rather than a path that fails to open. A
// job whose drive is unplugged has to be POSTPONED, and postponing is a
// different outcome from failing: nothing is wrong, the disk is simply in
// somebody's bag.
var ErrNotAttached = errors.New("that volume is not attached")

// Mark writes an identity onto a volume, or returns the one already there.
//
// Marking twice is not an error and does not produce a second identity. A
// person who clicks the button again on a disk they already registered should
// get the same answer, not a new drive that shadows the old one.
func Mark(mount, label string) (Marker, error) {
	if existing, err := readMarker(mount); err == nil {
		if label != "" && label != existing.Label {
			existing.Label = label
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
	body, err := os.ReadFile(filepath.Join(mount, filepath.FromSlash(markerPath)))
	if err != nil {
		return Marker{}, err
	}
	var m Marker
	if err := json.Unmarshal(body, &m); err != nil {
		return Marker{}, fmt.Errorf("read the marker on %s: %w", mount, err)
	}
	if m.ID == "" {
		return Marker{}, fmt.Errorf("the marker on %s carries no identity", mount)
	}
	return m, nil
}

// Candidates lists the mount points a marked volume could be sitting on, and is
// a variable rather than a function so a test can point the search at
// directories it controls instead of at whatever is plugged into the machine
// running it. The real implementations are per platform.
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

// Resolve turns a job path into a real one.
//
// A path that does not start with the prefix is handed back untouched, so an
// ordinary local path and any rclone remote pass through unchanged and this
// costs nothing for the jobs that do not use it.
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
	// The drive itself is asked first, because a label somebody has just
	// changed is on the disk before it is in the register. Only when the drive
	// is not here does the register answer, which is exactly the moment a
	// person most needs a name they recognise.
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
