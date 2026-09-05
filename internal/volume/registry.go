package volume

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// A volume that is not attached still has to have a name.
//
// The marker file carries the label, but the marker is on the drive, and the
// moment somebody most needs to read the label is the moment the drive is in
// their bag. "Backup drive is not connected" is a sentence anybody can act on;
// "bc04a5dcbb9a2ba6c2b0236c is not connected" is not.
//
// So every volume that is ever seen is written down here, and the note survives
// the drive leaving. The register is a convenience and never an authority: the
// marker on the disk is what decides identity, and a register that is missing,
// stale or unwritable only costs a nicer message.

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

// SetRegistry says where to remember volumes. Called once at startup with a
// path beside the configuration. Until it is, nothing is remembered and the
// only cost is that an absent drive is named by its identity.
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

// Forget drops a volume from the register. The drive itself keeps its marker,
// so plugging it in again brings it straight back; this only removes the note
// that it was ever here.
func Forget(id string) {
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
		// Nothing changed worth a write. Volumes are looked up on every run of
		// every job, so rewriting the file each time would be a lot of disk for
		// a timestamp nobody reads to the second.
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

// readRegistry reads the note. Callers hold the lock.
//
// Every failure answers with an empty register rather than an error. A missing
// file is the ordinary first-run state, and a corrupt one must not stop a job
// from syncing: the worst it can cost is a less friendly name.
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

// writeRegistry replaces the note in one step, so a crash midway leaves the old
// one rather than half of a new one. Callers hold the lock.
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
