package vpnconn

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"sync"

	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// FileName is the file beside the configuration that keeps the tunnels and
// their sealed logins. It is not part of arrowloop.json, which the interface
// serves whole as a backup, so a backup never carries a login.
const FileName = "vpn.json"

// kept is what FileName holds.
type kept struct {
	Tunnels []keptTunnel `json:"tunnels,omitempty"`
	// Former is the tunnel a job of an older file that says only that it
	// goes through the VPN goes through: the one that was in use when there
	// could be only one.
	Former string `json:"former,omitempty"`

	// Provider and Logins are the file from before there could be several
	// tunnels: the provider runs went through and a login per provider. They
	// are read once and written as tunnels.
	Provider string            `json:"provider,omitempty"`
	Logins   map[string]string `json:"logins,omitempty"`
}

// keptTunnel is one tunnel. Place is no secret, so the list can name the
// tunnel without opening its login.
type keptTunnel struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Place    string `json:"place,omitempty"`
	// Login is sealed with the install's key.
	Login string `json:"login"`
}

// store reads FileName once and writes it through.
type store struct {
	path string
	key  []byte

	mu   sync.Mutex
	data kept
}

// openStore reads FileName, and writes a file from before there could be
// several tunnels as tunnels: one per stored login, named after its provider,
// with the one in use first and kept as Former. place names a tunnel from its
// login.
func openStore(dir string, key []byte, place func(Login) string) (*store, error) {
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
	if len(s.data.Logins) == 0 {
		return s, nil
	}
	err = s.update(func(k *kept) {
		ids := make([]string, 0, len(k.Logins))
		for id := range k.Logins {
			ids = append(ids, id)
		}
		slices.Sort(ids)
		if i := slices.Index(ids, k.Provider); i >= 0 {
			ids = append([]string{k.Provider}, slices.Delete(ids, i, i+1)...)
			k.Former = k.Provider
		}
		for _, id := range ids {
			login, _ := s.open(k.Logins[id])
			k.Tunnels = append(k.Tunnels, keptTunnel{ID: id, Provider: id, Place: place(login), Login: k.Logins[id]})
		}
		k.Provider, k.Logins = "", nil
	})
	return s, err
}

func (s *store) open(sealed string) (Login, error) {
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

func (s *store) seal(login Login) (string, error) {
	b, err := json.Marshal(login)
	if err != nil {
		return "", err
	}
	return security.Seal(s.key, string(b))
}

func (s *store) tunnels() []keptTunnel {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.data.Tunnels)
}

func (s *store) tunnel(id string) (keptTunnel, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.data.Tunnels, func(t keptTunnel) bool { return t.ID == id })
	if i < 0 {
		return keptTunnel{}, false
	}
	return s.data.Tunnels[i], true
}

func (s *store) former() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.data.Former
}

// login opens the sealed login of tunnel id.
func (s *store) login(id string) (Login, error) {
	t, ok := s.tunnel(id)
	if !ok {
		return Login{}, ErrNotSetUp
	}
	return s.open(t.Login)
}

// add seals login as a new tunnel of provider and returns its id: the
// provider's, or with a number after it for a second tunnel of one provider.
func (s *store) add(provider, place string, login Login) (string, error) {
	sealed, err := s.seal(login)
	if err != nil {
		return "", err
	}
	var id string
	err = s.update(func(k *kept) {
		id = provider
		for n := 2; slices.ContainsFunc(k.Tunnels, func(t keptTunnel) bool { return t.ID == id }); n++ {
			id = provider + "-" + strconv.Itoa(n)
		}
		k.Tunnels = append(k.Tunnels, keptTunnel{ID: id, Provider: provider, Place: place, Login: sealed})
	})
	return id, err
}

// save seals login in place of tunnel id's.
func (s *store) save(id, place string, login Login) error {
	sealed, err := s.seal(login)
	if err != nil {
		return err
	}
	return s.update(func(k *kept) {
		for i := range k.Tunnels {
			if k.Tunnels[i].ID == id {
				k.Tunnels[i].Place, k.Tunnels[i].Login = place, sealed
			}
		}
	})
}

// keep seals what a provider left in the login after a connect, such as a key
// it registered.
func (s *store) keep(id string, login Login) error {
	sealed, err := s.seal(login)
	if err != nil {
		return err
	}
	return s.update(func(k *kept) {
		for i := range k.Tunnels {
			if k.Tunnels[i].ID == id {
				k.Tunnels[i].Login = sealed
			}
		}
	})
}

func (s *store) forget(id string) error {
	return s.update(func(k *kept) {
		k.Tunnels = slices.DeleteFunc(k.Tunnels, func(t keptTunnel) bool { return t.ID == id })
		if k.Former == id {
			k.Former = ""
		}
	})
}

// update changes a copy and writes it before it takes its place, so a disk
// that refuses the write leaves the state as the file says.
func (s *store) update(edit func(*kept)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.data
	next.Tunnels = slices.Clone(s.data.Tunnels)
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
