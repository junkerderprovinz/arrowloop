package pairing

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/member"

	"github.com/junkerderprovinz/arrowloop/internal/fsretry"
)

// legacyGroupFile is where releases up to 2.6 kept who is in the group. Open
// moves what it holds into the group's state here and sets the file aside, so
// leaving and joining again never brings its members back.
const legacyGroupFile = "group.json"

// legacyGroup is the shape of legacyGroupFile.
type legacyGroup struct {
	JoinedAt     time.Time `json:"joinedAt"`
	MemberSeenAt time.Time `json:"memberSeenAt"`
	Members      map[string]struct {
		Name       string    `json:"name"`
		Deployment string    `json:"deployment"`
		Address    string    `json:"address"`
		LastSeen   time.Time `json:"lastSeen"`
	} `json:"members"`
	Keys map[string]struct {
		Key      []byte    `json:"key"`
		Kind     string    `json:"kind"`
		Used     time.Time `json:"used"`
		Approved bool      `json:"approved"`
	} `json:"keys"`
	Revoked map[string]time.Time `json:"revoked"`
}

// kitState is the state the kit's group keeps in its Store. The kit offers no
// way to hand it members from before, so the migration writes its shape, and
// TestAGroupFromBeforeTheKitKeepsItsMembers reads the result back through the
// kit itself.
type kitState struct {
	Group   string               `json:"group"`
	Members map[string]kitMember `json:"members,omitempty"`
	Removed map[string]time.Time `json:"removed,omitempty"`
	Revoked map[string]time.Time `json:"revoked,omitempty"`
}

type kitMember struct {
	Kind       member.Kind `json:"kind"`
	Key        []byte      `json:"key"`
	Approved   bool        `json:"approved"`
	Used       time.Time   `json:"used"`
	Seen       time.Time   `json:"seen"`
	Name       string      `json:"name,omitempty"`
	Deployment string      `json:"deployment,omitempty"`
	Address    string      `json:"address,omitempty"`
}

// migrate takes the members and removals out of legacyGroupFile in dir, if
// there is one, and sets the file aside. Outside a group there is nobody to
// take over.
func (s *Store) migrate(dir string) error {
	path := filepath.Join(dir, legacyGroupFile)
	raw, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return nil
	case err != nil:
		return fmt.Errorf("read %s: %w", path, err)
	}
	var old legacyGroup
	if err := json.Unmarshal(raw, &old); err != nil {
		return fmt.Errorf("%s is damaged (%v); move it aside to start the group over", path, err)
	}
	if s.now.Secret != nil {
		state, err := json.Marshal(fromLegacy(old, Domain.GroupKey(s.now.Secret)))
		if err != nil {
			return err
		}
		next := s.now.clone()
		next.JoinedAt, next.MemberSeenAt = old.JoinedAt, old.MemberSeenAt
		if err := s.write(next, state); err != nil {
			return err
		}
		s.now, s.group = next, state
	}
	if err := fsretry.Rename(path, path+".bak"); err != nil {
		return fmt.Errorf("set %s aside: %w", path, err)
	}
	return nil
}

// fromLegacy is old as the kit keeps it for the group behind groupKey. Every
// member of an ArrowLoop group is an instance, and a revoked key stands for
// the instance id it makes.
func fromLegacy(old legacyGroup, groupKey string) kitState {
	st := kitState{Group: groupKey, Members: map[string]kitMember{}, Removed: map[string]time.Time{}, Revoked: map[string]time.Time{}}
	for id, pin := range old.Keys {
		if member.Kind(pin.Kind) != member.KindInstance || member.ID(member.KindInstance, pin.Key) != id {
			continue
		}
		m := kitMember{Kind: member.KindInstance, Key: pin.Key, Approved: pin.Approved, Used: pin.Used}
		if known, ok := old.Members[id]; ok {
			m.Name, m.Deployment, m.Address, m.Seen = known.Name, known.Deployment, known.Address, known.LastSeen
		}
		st.Members[id] = m
	}
	for keyHex, at := range old.Revoked {
		st.Revoked[keyHex] = at
		if key, err := hex.DecodeString(keyHex); err == nil {
			if id := member.ID(member.KindInstance, key); id != "" {
				st.Removed[id] = at
			}
		}
	}
	return st
}
