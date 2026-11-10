package pairing

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/group"
	"github.com/junkerderprovinz/parleyport/kit/member"

	"github.com/junkerderprovinz/arrowloop/internal/fsretry"
)

// legacyGroupFile is where releases up to 2.6 kept who is in the group. Its
// members move into the kit's group once that opens, and the file is set
// aside, so leaving and joining again never brings them back.
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

// readLegacy reads legacyGroupFile in dir, if there is one. Outside a group
// there is nobody to take over, and the file is set aside at once.
func (s *Store) readLegacy(dir string) error {
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
	if s.now.Secret == nil {
		return setAside(path)
	}
	next := s.now.clone()
	next.JoinedAt, next.MemberSeenAt = old.JoinedAt, old.MemberSeenAt
	if err := s.write(next, s.group); err != nil {
		return err
	}
	roster := fromLegacy(old)
	s.now, s.legacy, s.legacyPath = next, &roster, path
	return nil
}

// MoveLegacy takes the members of the group from before into g, which has to
// be the group of the phrase stored here, and sets the old file aside. It does
// nothing when there is none.
func (s *Store) MoveLegacy(g *group.Group) error {
	s.mu.Lock()
	legacy, path := s.legacy, s.legacyPath
	s.mu.Unlock()
	if legacy == nil {
		return nil
	}
	// Unlocked, since the group saves what it imports into this store.
	if err := g.Import(*legacy); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.legacy != legacy {
		return nil
	}
	if err := setAside(path); err != nil {
		return err
	}
	s.legacy = nil
	return nil
}

func setAside(path string) error {
	if err := fsretry.Rename(path, path+".bak"); err != nil {
		return fmt.Errorf("set %s aside: %w", path, err)
	}
	return nil
}

// fromLegacy is old as a roster of the kit. Every member of an ArrowLoop
// group is an instance.
func fromLegacy(old legacyGroup) group.Roster {
	r := group.Roster{Removed: map[string]time.Time{}, Revoked: map[string]time.Time{}}
	for id, pin := range old.Keys {
		m := group.Member{ID: id, Kind: member.Kind(pin.Kind), Key: pin.Key, State: group.StatePending, LastSeen: pin.Used}
		if pin.Approved {
			m.State = group.StateApproved
		}
		if known, ok := old.Members[id]; ok {
			m.Name, m.Deployment, m.Address = known.Name, known.Deployment, known.Address
			if known.LastSeen.After(m.LastSeen) {
				m.LastSeen = known.LastSeen
			}
		}
		r.Members = append(r.Members, m)
	}
	for keyHex, at := range old.Revoked {
		r.Revoked[keyHex] = at
		if key, err := hex.DecodeString(keyHex); err == nil {
			if id := member.ID(member.KindInstance, key); id != "" {
				r.Removed[id] = at
			}
		}
	}
	return r
}
