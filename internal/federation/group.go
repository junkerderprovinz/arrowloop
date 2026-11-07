package federation

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/fsretry"
	"github.com/junkerderprovinz/arrowloop/internal/relay"
)

// groupFile keeps when this instance entered its group, when another member
// first showed up there, the members approved here and the keys pinned and
// revoked. The Pairing tile tells a group still waiting for its second member
// from two instances that each made a phrase of their own by it, on the
// server's clock rather than the browser's.
type groupFile struct {
	path string

	mu    sync.Mutex
	state GroupState
}

// GroupState is where this instance stands in its group.
type GroupState struct {
	// JoinedAt is when this instance made or entered its phrase, zero outside
	// a group.
	JoinedAt time.Time `json:"joinedAt"`
	// MemberSeenAt is when another instance of the group was first there after
	// JoinedAt, zero until one has been.
	MemberSeenAt time.Time `json:"memberSeenAt"`
	// Members is every other instance approved in the group, by its id, as it
	// last announced itself, so one that is closed or away keeps its card.
	Members map[string]KnownMember `json:"members,omitempty"`
	// Keys is the member key pinned to every member id that signed a call
	// here, and Revoked every key taken out of the group, by its hex, with
	// when. See relay/member.go.
	Keys    map[string]PinnedKey `json:"keys,omitempty"`
	Revoked map[string]time.Time `json:"revoked,omitempty"`
}

// PinnedKey is the key a member signs with, pinned on its first signed call.
type PinnedKey struct {
	Key  []byte `json:"key"`
	Kind string `json:"kind"`
	// Used is when the key last signed a call here, kept to within
	// lastSeenStep.
	Used time.Time `json:"used"`
	// Approved is whether somebody at an instance let the member in. A key
	// that is pinned but not approved is refused.
	Approved bool `json:"approved"`
}

// KnownMember is another instance of the group as it last announced itself.
type KnownMember struct {
	// Name is "" when the member announced none of its own.
	Name       string    `json:"name,omitempty"`
	Deployment string    `json:"deployment,omitempty"`
	Address    string    `json:"address,omitempty"`
	LastSeen   time.Time `json:"lastSeen"`
}

// AwayMember is an instance approved in the group that is not reachable now.
type AwayMember struct {
	ID string
	KnownMember
}

// lastSeenStep is how far a member's last-seen time may lag before it is
// written again, so an open page does not rewrite the file on every poll.
const lastSeenStep = time.Minute

// loadGroupFile reads path. A file that is there but does not read is an
// error rather than an empty group, which would drop every approval and
// revoked key and let in again whoever they kept out.
func loadGroupFile(path string) (*groupFile, error) {
	g := &groupFile{path: path}
	b, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return g, nil
	case err != nil:
		return nil, err
	}
	if err := json.Unmarshal(b, &g.state); err != nil {
		return nil, fmt.Errorf("federation: %s is damaged; move it aside to start the group over: %w", path, err)
	}
	return g, nil
}

// flushLocked replaces the file through a synced temporary file in the same
// folder, so a crash leaves the old state or the new one and never a cut-off
// file.
func (g *groupFile) flushLocked() error {
	b, err := json.Marshal(g.state)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(g.path), "."+filepath.Base(g.path)+".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = fsretry.Rename(tmp, g.path)
	}
	if err != nil {
		os.Remove(tmp)
	}
	return err
}

// SetJoined records that this instance entered a group at at, or left its
// group when at is zero. Nobody has been seen in the group that follows, and
// every member that signs in has to be approved here, the instances that were
// there before this one included.
func (m *Manager) SetJoined(at time.Time) error {
	m.mu.Lock()
	m.awaiting, m.heard, m.greeted = nil, nil, nil
	m.mu.Unlock()
	m.group.mu.Lock()
	defer m.group.mu.Unlock()
	m.group.state = GroupState{JoinedAt: at}
	return m.group.flushLocked()
}

// AwayMembers records the members approved here that are reachable at now and
// returns the ones that are not, as each last announced itself. A desktop app
// that was closed or a phone that is asleep stays in the group until somebody
// takes it out.
func (m *Manager) AwayMembers(now time.Time) ([]AwayMember, error) {
	there := map[string]Instance{}
	for _, in := range m.Members() {
		there[in.ID] = in
	}

	m.group.mu.Lock()
	defer m.group.mu.Unlock()
	st := &m.group.state
	if st.JoinedAt.IsZero() {
		return nil, nil
	}
	dirty := false
	for id, in := range there {
		if !approvedInstanceLocked(st, id) {
			continue
		}
		seen := KnownMember{Name: in.Name, Deployment: in.Deployment, Address: in.Address, LastSeen: now}
		known, ok := st.Members[id]
		if ok && known.Name == seen.Name && known.Deployment == seen.Deployment && known.Address == seen.Address &&
			now.Sub(known.LastSeen) < lastSeenStep {
			continue
		}
		if st.Members == nil {
			st.Members = map[string]KnownMember{}
		}
		st.Members[id] = seen
		dirty = true
	}
	var err error
	if dirty {
		err = m.group.flushLocked()
	}

	var out []AwayMember
	for id, known := range st.Members {
		if _, on := there[id]; on {
			continue
		}
		if used := st.Keys[id].Used; used.After(known.LastSeen) {
			known.LastSeen = used
		}
		out = append(out, AwayMember{ID: id, KnownMember: known})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].ID < out[j].ID
	})
	return out, err
}

// approvedInstanceLocked reports whether id is an instance whose key was let
// into the group here. Only such a member is remembered while it is away, so
// a stranger holding the words leaves nothing behind.
func approvedInstanceLocked(st *GroupState, id string) bool {
	pin, ok := st.Keys[id]
	return ok && pin.Approved && pin.Kind == relay.KindInstance
}

// ErrNotInstance is what RemoveMember answers for an id no instance has.
var ErrNotInstance = errors.New("federation: that id belongs to no instance")

// RemoveMember revokes the key pinned to instance id at now and forgets its
// card. Its id stays free, so the instance can enter the phrase again and join
// under a new key; the old key never speaks here again.
func (m *Manager) RemoveMember(id string, now time.Time) error {
	if !relay.ValidInstanceID(id) {
		return ErrNotInstance
	}
	m.group.mu.Lock()
	defer m.group.mu.Unlock()
	st := &m.group.state
	_, known := st.Members[id]
	delete(st.Members, id)
	if !revokeLocked(st, id, now) && !known {
		return nil
	}
	return m.group.flushLocked()
}

// revokeLocked moves the key pinned to id onto the revoked list and reports
// whether there was one.
func revokeLocked(st *GroupState, id string, now time.Time) bool {
	pin, ok := st.Keys[id]
	if !ok {
		return false
	}
	delete(st.Keys, id)
	if st.Revoked == nil {
		st.Revoked = map[string]time.Time{}
	}
	if len(st.Revoked) >= maxRevoked {
		oldest := ""
		for key, at := range st.Revoked {
			if oldest == "" || at.Before(st.Revoked[oldest]) {
				oldest = key
			}
		}
		delete(st.Revoked, oldest)
	}
	st.Revoked[hex.EncodeToString(pin.Key)] = now
	return true
}

// Group reports where this instance stands in its group. anyone is whether
// another instance is there at now, and the first time one is, is kept as
// MemberSeenAt.
func (m *Manager) Group(anyone bool, now time.Time) (GroupState, error) {
	m.group.mu.Lock()
	defer m.group.mu.Unlock()
	st := m.group.state
	if anyone && !st.JoinedAt.IsZero() && st.MemberSeenAt.IsZero() {
		m.group.state.MemberSeenAt = now
		if err := m.group.flushLocked(); err != nil {
			return st, err
		}
		st = m.group.state
	}
	return st, nil
}
