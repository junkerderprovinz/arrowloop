package vpnconn

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// FileName is the file beside the configuration that keeps the provider in
// use and the sealed logins. It is not part of arrowloop.json, which the
// interface serves whole as a backup, so a backup never carries a login.
const FileName = "vpn.json"

// kept is what FileName holds.
type kept struct {
	// Provider is the one runs go through, "" for none.
	Provider string `json:"provider,omitempty"`
	// Logins are sealed with the install's key, one per provider.
	Logins map[string]string `json:"logins,omitempty"`
}

// store reads FileName once and writes it through.
type store struct {
	path string
	key  []byte

	mu   sync.Mutex
	data kept
}

func openStore(dir string, key []byte) (*store, error) {
	s := &store{path: filepath.Join(dir, FileName), key: key}
	b, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return s, nil
	case err != nil:
		return nil, err
	}
	if err := json.Unmarshal(b, &s.data); err != nil {
		return nil, fmt.Errorf("read %s: %w", s.path, err)
	}
	return s, nil
}

func (s *store) provider() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.data.Provider
}

func (s *store) configured() map[string]bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]bool, len(s.data.Logins))
	for id := range s.data.Logins {
		out[id] = true
	}
	return out
}

// login opens the sealed login of id, an empty one where there is none.
func (s *store) login(id string) (Login, error) {
	s.mu.Lock()
	sealed := s.data.Logins[id]
	s.mu.Unlock()
	login := Login{}
	if sealed == "" {
		return login, nil
	}
	plain, err := security.Unseal(s.key, sealed)
	if err != nil {
		return login, fmt.Errorf("the stored login cannot be read: %w", err)
	}
	return login, json.Unmarshal([]byte(plain), &login)
}

// save seals login under id and makes id the provider in use.
func (s *store) save(id string, login Login) error {
	b, err := json.Marshal(login)
	if err != nil {
		return err
	}
	sealed, err := security.Seal(s.key, string(b))
	if err != nil {
		return err
	}
	return s.update(func(k *kept) {
		if k.Logins == nil {
			k.Logins = map[string]string{}
		}
		k.Logins[id] = sealed
		k.Provider = id
	})
}

// keep seals what a provider left in the login after a connect, such as a key
// it registered, without changing the provider in use.
func (s *store) keep(id string, login Login) error {
	b, err := json.Marshal(login)
	if err != nil {
		return err
	}
	sealed, err := security.Seal(s.key, string(b))
	if err != nil {
		return err
	}
	return s.update(func(k *kept) {
		if _, ok := k.Logins[id]; ok {
			k.Logins[id] = sealed
		}
	})
}

func (s *store) forget(id string) error {
	return s.update(func(k *kept) {
		delete(k.Logins, id)
		if k.Provider == id {
			k.Provider = ""
		}
	})
}

func (s *store) use(id string) error {
	return s.update(func(k *kept) { k.Provider = id })
}

// update changes a copy and writes it before it takes its place, so a disk
// that refuses the write leaves the state as the file says.
func (s *store) update(edit func(*kept)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := kept{Provider: s.data.Provider, Logins: make(map[string]string, len(s.data.Logins))}
	for id, v := range s.data.Logins {
		next.Logins[id] = v
	}
	edit(&next)
	b, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		os.Remove(tmp)
		return err
	}
	s.data = next
	return nil
}
