// Package pairing keeps what this instance needs to be in a group: the secret
// behind the phrase, the member key it signs with, which relay it dials and the
// name the others see. The secret and the key are sealed with the install's
// key, as the second factor is in the security file.
package pairing

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/junkerderprovinz/arrowloop/internal/fsretry"
	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// FileName is the file beside the configuration that holds the state.
const FileName = "pairing.json"

// The relays an instance can dial: the one the project runs, one of the
// owner's own, or none.
const (
	ModeProject = "project"
	ModeOwn     = "own"
	ModeOff     = "off"
)

// ValidMode reports whether mode is one an owner can choose.
func ValidMode(mode string) bool {
	return mode == ModeProject || mode == ModeOwn || mode == ModeOff
}

// State is where this instance stands.
type State struct {
	// Secret is the 16 bytes the phrase spells, nil outside a group.
	Secret []byte
	// Member is the seed of the key this instance signs its calls to the
	// group with. It belongs to one group: entering one mints a new seed.
	Member []byte
	// RelayMode is one of the modes above; anything else counts as the
	// project relay (see Mode).
	RelayMode string
	// RelayURL is the owner's own relay, used only in ModeOwn.
	RelayURL string
	// RelayServe is whether this instance runs a relay for its group at
	// /relay/connect on its own address. It is kept apart from the mode: the
	// instance that serves dials its own relay like any other member.
	RelayServe bool
	// Name is what the other instances see, "" for the hostname.
	Name string
}

// Mode is the relay mode in force.
func (s State) Mode() string {
	if ValidMode(s.RelayMode) {
		return s.RelayMode
	}
	return ModeProject
}

// onDisk is the file's shape, with the secret and the key sealed.
type onDisk struct {
	Secret     string `json:"secret,omitempty"`
	Member     string `json:"member,omitempty"`
	RelayMode  string `json:"relayMode,omitempty"`
	RelayURL   string `json:"relayUrl,omitempty"`
	RelayServe bool   `json:"relayServe,omitempty"`
	Name       string `json:"name,omitempty"`
}

// Store reads and writes the file.
type Store struct {
	mu   sync.Mutex
	path string
	key  []byte
	now  State
}

// Open reads the file in dir. A missing file is an instance outside any
// group; one that cannot be read or opened is an error, since starting
// without it would put the instance outside its group without a word.
func Open(dir string, key []byte) (*Store, error) {
	s := &Store{path: filepath.Join(dir, FileName), key: key}
	body, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", s.path, err)
	}
	var d onDisk
	if err := json.Unmarshal(body, &d); err != nil {
		return nil, fmt.Errorf("%s is damaged (%v); delete it to leave the group and pair again", s.path, err)
	}
	st := State{RelayMode: d.RelayMode, RelayURL: d.RelayURL, RelayServe: d.RelayServe, Name: d.Name}
	if st.Secret, err = s.open(d.Secret); err != nil {
		return nil, err
	}
	if st.Member, err = s.open(d.Member); err != nil {
		return nil, err
	}
	s.now = st
	return s, nil
}

func (s *Store) open(sealed string) ([]byte, error) {
	if sealed == "" {
		return nil, nil
	}
	plain, err := security.Unseal(s.key, sealed)
	if err == nil {
		var b []byte
		if b, err = hex.DecodeString(plain); err == nil {
			return b, nil
		}
	}
	return nil, fmt.Errorf("%s does not open: %w. Set %s to the key it was written with, or delete the file to leave the group and pair again",
		s.path, err, security.KeyEnv)
}

// Get returns a copy of the current state.
func (s *Store) Get() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.now.clone()
}

func (st State) clone() State {
	st.Secret = bytes.Clone(st.Secret)
	st.Member = bytes.Clone(st.Member)
	return st
}

// Update applies fn to a copy of the state and writes the result. When fn
// returns an error, or the write fails, nothing changes.
func (s *Store) Update(fn func(*State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.now.clone()
	if err := fn(&next); err != nil {
		return err
	}
	if err := s.write(next); err != nil {
		return err
	}
	s.now = next.clone()
	return nil
}

func (s *Store) write(st State) error {
	d := onDisk{RelayMode: st.RelayMode, RelayURL: st.RelayURL, RelayServe: st.RelayServe, Name: st.Name}
	var err error
	if d.Secret, err = s.seal(st.Secret); err != nil {
		return err
	}
	if d.Member, err = s.seal(st.Member); err != nil {
		return err
	}
	body, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("prepare %s: %w", filepath.Dir(s.path), err)
	}
	tmp := s.path + ".writing"
	if err := os.WriteFile(tmp, append(body, '\n'), 0o600); err != nil {
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if err := fsretry.Rename(tmp, s.path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("replace %s: %w", s.path, err)
	}
	return nil
}

func (s *Store) seal(b []byte) (string, error) {
	if len(b) == 0 {
		return "", nil
	}
	return security.Seal(s.key, hex.EncodeToString(b))
}
