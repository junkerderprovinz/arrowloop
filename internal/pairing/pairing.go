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
	"slices"
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

	// Fortress is whether Secret is the phrase of a fortress, which the
	// pairing derives its keys from as well.
	Fortress bool
	// PairingPrevious is the secret the pairing's keys came from before: the
	// app's own phrase on entering the fortress, the fortress's phrase before
	// once that changed. FortressPrevious is the fortress's secret before its
	// phrase changed, at FortressChanged. The kit takes over what was kept
	// under them.
	PairingPrevious  []byte
	FortressPrevious []byte
	FortressChanged  time.Time
	// MoveFrom is the app's own phrase while instances that were away still
	// have to be handed the fortress phrase over it.
	MoveFrom []byte
	// Removed are the members this instance took out of the fortress since
	// its phrase last changed, which that phrase still lets back in.
	Removed []Removed
	// RemovedHere says another member took this instance out, until it joins
	// a fortress again.
	RemovedHere bool
}

// Removed is a member taken out of the fortress, by the names it went by.
type Removed struct {
	App    string `json:"app"`
	Name   string `json:"name"`
	Device string `json:"device"`
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

	Fortress         bool      `json:"fortress,omitempty"`
	PairingPrevious  string    `json:"pairingPrevious,omitempty"`
	FortressPrevious string    `json:"fortressPrevious,omitempty"`
	FortressChanged  time.Time `json:"fortressChanged,omitzero"`
	MoveFrom         string    `json:"moveFrom,omitempty"`
	FortressGroup    string    `json:"fortressGroup,omitempty"`
	MoveGroup        string    `json:"moveGroup,omitempty"`
	Removed          string    `json:"removed,omitempty"`
	RemovedHere      bool      `json:"removedHere,omitempty"`
}

// blobs are what the kit keeps for the pairing, the fortress and the move,
// each sealed in the file.
type blobs struct {
	group, fortress, moving []byte
}

// Store reads and writes the file.
type Store struct {
	mu   sync.Mutex
	path string
	key  []byte
	now  State
	// b is what the kit keeps, each nil until it saved once in the current
	// group.
	b blobs
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
		JoinedAt: d.JoinedAt, MemberSeenAt: d.MemberSeenAt, Fortress: d.Fortress, FortressChanged: d.FortressChanged,
		RemovedHere: d.RemovedHere,
	}
	if d.Removed != "" {
		plain, err := security.Unseal(s.key, d.Removed)
		if err != nil {
			return s.unopened(err)
		}
		if err := json.Unmarshal([]byte(plain), &st.Removed); err != nil {
			return fmt.Errorf("%s is damaged (%v); delete it to leave the group and pair again", s.path, err)
		}
	}
	for _, f := range []struct {
		into   *[]byte
		sealed string
	}{
		{&st.Secret, d.Secret}, {&st.Member, d.Member}, {&st.PairingPrevious, d.PairingPrevious},
		{&st.FortressPrevious, d.FortressPrevious}, {&st.MoveFrom, d.MoveFrom},
	} {
		var err error
		if *f.into, err = s.openHex(f.sealed); err != nil {
			return err
		}
	}
	for _, f := range []struct {
		into   *[]byte
		sealed string
	}{{&s.b.group, d.Group}, {&s.b.fortress, d.FortressGroup}, {&s.b.moving, d.MoveGroup}} {
		if f.sealed == "" {
			continue
		}
		plain, err := security.Unseal(s.key, f.sealed)
		if err != nil {
			return s.unopened(err)
		}
		*f.into = []byte(plain)
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
	st.PairingPrevious = bytes.Clone(st.PairingPrevious)
	st.FortressPrevious = bytes.Clone(st.FortressPrevious)
	st.MoveFrom = bytes.Clone(st.MoveFrom)
	st.Removed = slices.Clone(st.Removed)
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
	kept := s.b
	another := !bytes.Equal(next.Secret, s.now.Secret)
	if another {
		kept = blobs{}
		next.PairingPrevious, next.FortressPrevious, next.MoveFrom = nil, nil, nil
		next.FortressChanged, next.Removed = time.Time{}, nil
	}
	if err := s.write(next, kept); err != nil {
		return err
	}
	s.now, s.b = next.clone(), kept
	if another && s.legacy != nil {
		s.legacy = nil
		return setAside(s.legacyPath)
	}
	return nil
}

// EnterFortress makes secret the phrase of this instance, as the fortress it
// joins. The pairing moves over from the app's own phrase, if there was one,
// keeping who was approved, and the move to the instances that were away
// starts from a copy of that.
func (s *Store) EnterFortress(secret []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.now.clone()
	kept := blobs{group: s.b.group}
	if next.Secret != nil && !next.Fortress {
		next.PairingPrevious, next.MoveFrom = bytes.Clone(next.Secret), bytes.Clone(next.Secret)
		kept.moving = bytes.Clone(s.b.group)
	}
	next.Secret, next.Fortress, next.FortressPrevious, next.FortressChanged = bytes.Clone(secret), true, nil, time.Time{}
	next.Removed, next.RemovedHere = nil, false
	if err := s.write(next, kept); err != nil {
		return err
	}
	s.now, s.b = next, kept
	return nil
}

// ChangeFortressSecret takes the fortress's new phrase and keeps the one
// before for the kit to move the fortress and the pairing from, since the
// pairing's keys come from the fortress phrase.
func (s *Store) ChangeFortressSecret(secret []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.now.clone()
	next.FortressPrevious, next.PairingPrevious, next.Secret = next.Secret, bytes.Clone(next.Secret), bytes.Clone(secret)
	next.FortressChanged, next.Removed = time.Now().Round(0), nil
	if err := s.write(next, s.b); err != nil {
		return err
	}
	s.now = next
	return nil
}

// ForgetFortressPrevious drops the fortress's secret before its phrase
// changed, in the pairing as well where its keys came from that one.
func (s *Store) ForgetFortressPrevious() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.now.clone()
	if bytes.Equal(next.PairingPrevious, next.FortressPrevious) {
		next.PairingPrevious = nil
	}
	next.FortressPrevious, next.FortressChanged = nil, time.Time{}
	if err := s.write(next, s.b); err != nil {
		return err
	}
	s.now = next
	return nil
}

// MoveDone forgets the app's own phrase once every instance it paired has the
// fortress's.
func (s *Store) MoveDone() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.now.clone()
	next.MoveFrom = nil
	kept := s.b
	kept.moving = nil
	if err := s.write(next, kept); err != nil {
		return err
	}
	s.now, s.b = next, kept
	return nil
}

// GroupStore is where the kit keeps the pairing, FortressStore the fortress
// and MoveStore the pairing under the app's own phrase while it moves, all in
// this file.
func (s *Store) GroupStore() group.Store {
	return blobStore{s, func(b *blobs) *[]byte { return &b.group }}
}

func (s *Store) FortressStore() group.Store {
	return blobStore{s, func(b *blobs) *[]byte { return &b.fortress }}
}

func (s *Store) MoveStore() group.Store {
	return blobStore{s, func(b *blobs) *[]byte { return &b.moving }}
}

type blobStore struct {
	s     *Store
	field func(*blobs) *[]byte
}

func (g blobStore) Load() ([]byte, error) {
	g.s.mu.Lock()
	defer g.s.mu.Unlock()
	return bytes.Clone(*g.field(&g.s.b)), nil
}

func (g blobStore) Save(raw []byte) error {
	g.s.mu.Lock()
	defer g.s.mu.Unlock()
	kept := g.s.b
	*g.field(&kept) = bytes.Clone(raw)
	if err := g.s.write(g.s.now, kept); err != nil {
		return err
	}
	g.s.b = kept
	return nil
}

func (s *Store) write(st State, b blobs) error {
	d := onDisk{
		RelayMode: st.RelayMode, RelayURL: st.RelayURL, RelayServe: st.RelayServe, Name: st.Name,
		JoinedAt: st.JoinedAt, MemberSeenAt: st.MemberSeenAt, Fortress: st.Fortress, FortressChanged: st.FortressChanged,
		RemovedHere: st.RemovedHere,
	}
	if len(st.Removed) > 0 {
		plain, err := json.Marshal(st.Removed)
		if err != nil {
			return err
		}
		if d.Removed, err = security.Seal(s.key, string(plain)); err != nil {
			return err
		}
	}
	for _, f := range []struct {
		into  *string
		plain []byte
	}{
		{&d.Secret, st.Secret}, {&d.Member, st.Member}, {&d.PairingPrevious, st.PairingPrevious},
		{&d.FortressPrevious, st.FortressPrevious}, {&d.MoveFrom, st.MoveFrom},
	} {
		var err error
		if *f.into, err = s.sealHex(f.plain); err != nil {
			return err
		}
	}
	for _, f := range []struct {
		into  *string
		plain []byte
	}{{&d.Group, b.group}, {&d.FortressGroup, b.fortress}, {&d.MoveGroup, b.moving}} {
		if len(f.plain) == 0 {
			continue
		}
		var err error
		if *f.into, err = security.Seal(s.key, string(f.plain)); err != nil {
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
