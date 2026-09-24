// Package security keeps what the interface sets up about signing in: the
// password hash, the second factor and the registered passkeys.
//
// They live in security.json beside the configuration file and never in it.
// The API serves arrowloop.json whole as a backup and replaces it whole on a
// restore, so a hash in there would be handed out over the routes it guards,
// and restoring an older backup would quietly switch the protection off.
package security

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

// FileName is the file beside the configuration that holds the login settings.
const FileName = "security.json"

// TOTP is the second factor. Secret is kept while Enabled is still false, so
// the confirming code is checked against a secret that never went back to the
// browser.
type TOTP struct {
	Secret  string `json:"secret,omitempty"`
	Enabled bool   `json:"enabled,omitempty"`

	// Recovery holds the hashes of the unused recovery codes.
	Recovery []string `json:"recovery,omitempty"`

	// LastStep is the time step of the last code accepted, so a code that was
	// read over somebody's shoulder cannot be used a second time inside its
	// thirty seconds.
	LastStep uint64 `json:"lastStep,omitempty"`
}

// Passkey is one registered WebAuthn credential. Only the public half is
// stored.
type Passkey struct {
	ID   string `json:"id"`
	Name string `json:"name"`

	// CredentialID is the authenticator's handle for the key, unique per key.
	CredentialID []byte `json:"credentialId"`

	// PublicKey is the COSE-encoded public half.
	PublicKey []byte `json:"publicKey"`

	// AAGUID names the authenticator model; some security keys report none.
	AAGUID []byte `json:"aaguid,omitempty"`

	// SignCount is the authenticator's counter. One that goes backwards is how
	// a cloned key shows; many modern authenticators always report zero.
	SignCount uint32 `json:"signCount"`

	// Transports is the comma-joined hint list ("internal", "usb", "hybrid"),
	// handed back at login so the browser raises the right prompt.
	Transports string `json:"transports,omitempty"`

	// RPID is the host name the key is bound to. The same machine reached under
	// two names has two separate sets.
	RPID string `json:"rpId"`

	// BackedUp says the authenticator syncs the key to a cloud keychain. One
	// that does not is gone with the device.
	BackedUp bool `json:"backedUp"`

	CreatedAt  int64 `json:"createdAt"`
	LastUsedAt int64 `json:"lastUsedAt,omitempty"`
}

// State is the whole file.
type State struct {
	// PasswordHash is a bcrypt hash, or empty when the interface set none.
	PasswordHash string `json:"passwordHash,omitempty"`

	TOTP TOTP `json:"totp"`

	Passkeys []Passkey `json:"passkeys,omitempty"`

	// PasskeyUser is the account id every passkey is registered under. It has
	// to stay the same for the keys to keep working, so it is drawn once.
	PasskeyUser []byte `json:"passkeyUser,omitempty"`
}

// clone copies the slices, so a caller holding a State cannot change the
// store's.
func (s State) clone() State {
	out := s
	out.TOTP.Recovery = slices.Clone(s.TOTP.Recovery)
	out.Passkeys = slices.Clone(s.Passkeys)
	out.PasskeyUser = slices.Clone(s.PasskeyUser)
	return out
}

// Store is security.json, read once and written through.
type Store struct {
	mu   sync.Mutex
	path string
	now  State
}

// Open reads the file beside the given configuration file. A missing file is
// an empty state. A file that cannot be read or parsed is an error rather than
// an empty state, because an empty state is an install without a password.
func Open(configPath string) (*Store, error) {
	s := &Store{path: filepath.Join(filepath.Dir(configPath), FileName)}
	body, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", s.path, err)
	}
	if err := json.Unmarshal(body, &s.now); err != nil {
		return nil, fmt.Errorf("%s is damaged (%v); delete it to start without a password, a second factor or passkeys", s.path, err)
	}
	return s, nil
}

// Path is where the file lives.
func (s *Store) Path() string { return s.path }

// Get returns a copy of the current state.
func (s *Store) Get() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.now.clone()
}

// Update applies fn to a copy of the state and writes the result. When fn
// returns an error, or the write fails, nothing changes, which is what lets a
// recovery code be refused rather than survive its own use.
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
	s.now = next
	return nil
}

// write replaces the file in one step, readable by the owner only.
func (s *Store) write(st State) error {
	body, err := json.MarshalIndent(st, "", "  ")
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
	if err := os.Rename(tmp, s.path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("replace %s: %w", s.path, err)
	}
	return nil
}

// ErrPasskeyExists is returned when the same authenticator is registered twice.
var ErrPasskeyExists = errors.New("this passkey is already registered")

// PasskeysFor returns the keys bound to one host name, the only ones a browser
// on that address will offer.
func (s State) PasskeysFor(rpID string) []Passkey {
	var out []Passkey
	for _, p := range s.Passkeys {
		if p.RPID == rpID {
			out = append(out, p)
		}
	}
	return out
}

// AddPasskey stores a freshly registered key and returns it with its id and
// time filled in.
func (s *Store) AddPasskey(p Passkey) (Passkey, error) {
	if len(p.CredentialID) == 0 || len(p.PublicKey) == 0 {
		return Passkey{}, errors.New("a passkey needs a credential id and a public key")
	}
	id, err := randomHex(16)
	if err != nil {
		return Passkey{}, err
	}
	p.ID = id
	err = s.Update(func(st *State) error {
		for _, have := range st.Passkeys {
			if string(have.CredentialID) == string(p.CredentialID) {
				return ErrPasskeyExists
			}
		}
		st.Passkeys = append(st.Passkeys, p)
		return nil
	})
	if err != nil {
		return Passkey{}, err
	}
	return p, nil
}

// TouchPasskey records a successful login with a key: its new counter and when.
func (s *Store) TouchPasskey(id string, signCount uint32, at int64) error {
	return s.Update(func(st *State) error {
		for i := range st.Passkeys {
			if st.Passkeys[i].ID == id {
				st.Passkeys[i].SignCount = signCount
				st.Passkeys[i].LastUsedAt = at
			}
		}
		return nil
	})
}

// DeletePasskey removes a key. Removing one that is not there is not an error.
func (s *Store) DeletePasskey(id string) error {
	return s.Update(func(st *State) error {
		st.Passkeys = slices.DeleteFunc(st.Passkeys, func(p Passkey) bool { return p.ID == id })
		return nil
	})
}

// PasskeyUser returns the account id passkeys are registered under, drawing
// it on first use.
func (s *Store) PasskeyUser() ([]byte, error) {
	if id := s.Get().PasskeyUser; len(id) > 0 {
		return id, nil
	}
	var id []byte
	err := s.Update(func(st *State) error {
		if len(st.PasskeyUser) == 0 {
			fresh := make([]byte, 32)
			if _, err := rand.Read(fresh); err != nil {
				return fmt.Errorf("draw a passkey account id: %w", err)
			}
			st.PasskeyUser = fresh
		}
		id = slices.Clone(st.PasskeyUser)
		return nil
	})
	return id, err
}

func randomHex(n int) (string, error) {
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("draw an id: %w", err)
	}
	return hex.EncodeToString(raw), nil
}
