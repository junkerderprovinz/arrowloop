package volume

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// The register remembers every volume ever seen, so a drive that is not
// attached can still be named by its label rather than its identity. Only the
// marker decides identity; a missing or stale register costs nothing but the
// nicer name.

// Known is a volume that has been seen at some point, whether or not it is
// here now.
type Known struct {
	ID       string    `json:"id"`
	Label    string    `json:"label"`
	Mount    string    `json:"mount"`
	LastSeen time.Time `json:"lastSeen"`
	Attached bool      `json:"attached"`
}

var (
	registryMu   sync.Mutex
	registryPath string
)

// SetRegistry says where to remember volumes. It is called once at startup;
// until then nothing is remembered.
func SetRegistry(path string) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registryPath = path
}

// Remembered lists every volume ever seen, the attached ones first.
func Remembered() []Known {
	here := map[string]Volume{}
	for _, v := range Attached() {
		here[v.ID] = v
	}

	registryMu.Lock()
	stored := readRegistry()
	registryMu.Unlock()

	out := make([]Known, 0, len(stored)+len(here))
	for _, k := range stored {
		if v, ok := here[k.ID]; ok {
			k.Label, k.Mount, k.Attached = v.Label, v.Mount, true
			delete(here, k.ID)
		} else {
			k.Attached = false
		}
		out = append(out, k)
	}
	// Anything attached that the register has not caught up with yet.
	for _, v := range here {
		out = append(out, Known{ID: v.ID, Label: v.Label, Mount: v.Mount, Attached: true, LastSeen: time.Now().UTC()})
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Attached != out[j].Attached {
			return out[i].Attached
		}
		return out[i].Label < out[j].Label
	})
	return out
}

// Forget drops a volume from the register and removes its marker if the drive
// is attached.
func Forget(id string) {
	// Remembered adds every attached volume back, so an attached drive keeps
	// showing up until its marker is gone. A drive that is not attached keeps
	// its marker and is registered again when it returns.
	unmark(id)

	registryMu.Lock()
	defer registryMu.Unlock()
	stored := readRegistry()
	kept := make([]Known, 0, len(stored))
	for _, k := range stored {
		if k.ID != id {
			kept = append(kept, k)
		}
	}
	writeRegistry(kept)
}

// unmark removes the identity file from the volume with this id, if it is
// attached.
func unmark(id string) {
	for _, v := range Attached() {
		if v.ID != id {
			continue
		}
		for _, rel := range []string{markerPath, legacyMarkerPath} {
			full := filepath.Join(v.Mount, filepath.FromSlash(rel))
			if err := os.Remove(full); err == nil {
				// The directory goes too, but only when empty: the trash
				// lives under it.
				_ = os.Remove(filepath.Dir(full))
			}
		}
		return
	}
}

// remember notes a volume that is here right now.
func remember(v Volume) {
	registryMu.Lock()
	defer registryMu.Unlock()
	if registryPath == "" {
		return
	}
	stored := readRegistry()
	now := time.Now().UTC()
	for i, k := range stored {
		if k.ID != v.ID {
			continue
		}
		// Volumes are looked up on every run, so an unchanged entry is only
		// rewritten once an hour.
		if k.Label == v.Label && k.Mount == v.Mount && now.Sub(k.LastSeen) < time.Hour {
			return
		}
		stored[i].Label, stored[i].Mount, stored[i].LastSeen = v.Label, v.Mount, now
		writeRegistry(stored)
		return
	}
	writeRegistry(append(stored, Known{ID: v.ID, Label: v.Label, Mount: v.Mount, LastSeen: now}))
}

// labelFor names a volume that may not be here, falling back to the identity
// when nothing better is known.
func labelFor(id string) string {
	registryMu.Lock()
	defer registryMu.Unlock()
	for _, k := range readRegistry() {
		if k.ID == id && k.Label != "" {
			return k.Label
		}
	}
	return id
}

// readRegistry reads the register, empty on any failure. Callers hold the
// lock.
func readRegistry() []Known {
	if registryPath == "" {
		return nil
	}
	body, err := os.ReadFile(registryPath)
	if err != nil {
		return nil
	}
	var out []Known
	if err := json.Unmarshal(body, &out); err != nil {
		return nil
	}
	return out
}

// writeRegistry replaces the register in one step, so a crash leaves the old
// one intact. Callers hold the lock.
func writeRegistry(all []Known) {
	if registryPath == "" {
		return
	}
	body, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(registryPath), 0o755); err != nil {
		return
	}
	tmp := registryPath + ".writing"
	if err := os.WriteFile(tmp, append(body, '\n'), 0o644); err != nil {
		return
	}
	if err := os.Rename(tmp, registryPath); err != nil {
		os.Remove(tmp)
	}
}
