// Package pairing keeps what this instance needs to be in a group: the secret
// behind the phrase, the member key it signs with, which relay it dials, the
// name the others see and the group's own state of who is approved. The
// secret, the key and the group's state are sealed with the install's key, as
// the second factor is in the security file.
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
	"time"

	"github.com/junkerderprovinz/parleyport/kit/group"
	"github.com/junkerderprovinz/parleyport/kit/keys"

	"github.com/junkerderprovinz/arrowloop/internal/fsretry"
	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// FileName is the file beside the configuration that holds the state.
const FileName = "pairing.json"

// Domain is what ArrowLoop derives its group's keys under, so the same words
// typed into another app never put the two in one group.
const Domain keys.Domain = "arrowloop"

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
	// JoinedAt is when this instance made or entered its phrase, and
	// MemberSeenAt when another instance of the group was first there after
	// that. The Pairing tile tells a group still waiting for its second member
	// from two instances that each made a phrase of their own by them.
	JoinedAt     time.Time
	MemberSeenAt time.Time
}

// Mode is the relay mode in force.
func (s State) Mode() string {
	if ValidMode(s.RelayMode) {
		return s.RelayMode
	}
	return ModeProject
}

// onDisk is the file's shape, with the secret, the key and the group sealed.
type onDisk struct {
	Secret       string    `json:"secret,omitempty"`
	Member       string    `json:"member,omitempty"`
	RelayMode    string    `json:"relayMode,omitempty"`
	RelayURL     string    `json:"relayUrl,omitempty"`
	RelayServe   bool      `json:"relayServe,omitempty"`
	Name         string    `json:"name,omitempty"`
	JoinedAt     time.Time `json:"joinedAt,omitzero"`
	MemberSeenAt time.Time `json:"memberSeenAt,omitzero"`
	Group        string    `json:"group,omitempty"`
}

// Store reads and writes the file.
type Store struct {
	mu   sync.Mutex
	path string
	key  []byte
	now  State
	// group is what the kit's group keeps about its members, nil until it
	// saved once in the current group.
	group []byte
	// legacy is the group from legacyGroupFile at legacyPath, until
	// MoveLegacy takes it over.
	legacy     *group.Roster
	legacyPath string
}

// Open reads the file in dir. A missing file is an instance outside any
// group; one that cannot be read or opened is an error, since starting
// without it would put the instance outside its group without a word.
func Open(dir string, key []byte) (*Store, error) {
	s := &Store{path: filepath.Join(dir, FileName), key: key}
	body, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, fmt.Errorf("read %s: %w", s.path, err)
	default:
		if err := s.read(body); err != nil {
			return nil, err
		}
	}
	if err := s.readLegacy(dir); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) read(body []byte) error {
	var d onDisk
	if err := json.Unmarshal(body, &d); err != nil {
		return fmt.Errorf("%s is damaged (%v); delete it to leave the group and pair again", s.path, err)
	}
	st := State{
		RelayMode: d.RelayMode, RelayURL: d.RelayURL, RelayServe: d.RelayServe, Name: d.Name,
		JoinedAt: d.JoinedAt, MemberSeenAt: d.MemberSeenAt,
	}
	var err error
	if st.Secret, err = s.openHex(d.Secret); err != nil {
		return err
	}
	if st.Member, err = s.openHex(d.Member); err != nil {
		return err
	}
	if d.Group != "" {
		plain, err := security.Unseal(s.key, d.Group)
		if err != nil {
			return s.unopened(err)
		}
		s.group = []byte(plain)
	}
	s.now = st
	return nil
}

func (s *Store) openHex(sealed string) ([]byte, error) {
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
	return nil, s.unopened(err)
}

func (s *Store) unopened(err error) error {
	return fmt.Errorf("%s does not open: %w. Set %s to the key it was written with, or delete the file to leave the group and pair again",
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
// returns an error, or the write fails, nothing changes. Another secret, or
// none, starts the group's state over.
func (s *Store) Update(fn func(*State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.now.clone()
	if err := fn(&next); err != nil {
		return err
	}
	state := s.group
	another := !bytes.Equal(next.Secret, s.now.Secret)
	if another {
		state = nil
	}
	if err := s.write(next, state); err != nil {
		return err
	}
	s.now, s.group = next.clone(), state
	if another && s.legacy != nil {
		s.legacy = nil
		return setAside(s.legacyPath)
	}
	return nil
}

// GroupStore is where the kit's group keeps its state, in this file.
func (s *Store) GroupStore() group.Store { return groupStore{s} }

type groupStore struct{ s *Store }

func (g groupStore) Load() ([]byte, error) {
	g.s.mu.Lock()
	defer g.s.mu.Unlock()
	return bytes.Clone(g.s.group), nil
}

func (g groupStore) Save(raw []byte) error {
	g.s.mu.Lock()
	defer g.s.mu.Unlock()
	raw = bytes.Clone(raw)
	if err := g.s.write(g.s.now, raw); err != nil {
		return err
	}
	g.s.group = raw
	return nil
}

func (s *Store) write(st State, group []byte) error {
	d := onDisk{
		RelayMode: st.RelayMode, RelayURL: st.RelayURL, RelayServe: st.RelayServe, Name: st.Name,
		JoinedAt: st.JoinedAt, MemberSeenAt: st.MemberSeenAt,
	}
	var err error
	if d.Secret, err = s.sealHex(st.Secret); err != nil {
		return err
	}
	if d.Member, err = s.sealHex(st.Member); err != nil {
		return err
	}
	if len(group) > 0 {
		if d.Group, err = security.Seal(s.key, string(group)); err != nil {
			return err
		}
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

func (s *Store) sealHex(b []byte) (string, error) {
	if len(b) == 0 {
		return "", nil
	}
	return security.Seal(s.key, hex.EncodeToString(b))
}
