package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"slices"
)

// ReadToken lets a dashboard that cannot pair read the fortress status and
// log. Only an HMAC of the token is kept, keyed with the install's key, so
// the file alone neither shows a token nor lets one be checked offline.
type ReadToken struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Hash      string `json:"hash"`
	CreatedAt int64  `json:"createdAt"`
}

// readTokenPrefix marks a token as ArrowLoop's, which secret scanners and
// people reading a dashboard's settings both recognise.
const readTokenPrefix = "alr_"

// AddReadToken draws a token, stores its HMAC under name and returns the
// token, which is shown once and never again.
func (s *Store) AddReadToken(name string, at int64) (string, ReadToken, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", ReadToken{}, fmt.Errorf("draw a read token: %w", err)
	}
	plain := readTokenPrefix + base64.RawURLEncoding.EncodeToString(raw)
	id, err := randomHex(8)
	if err != nil {
		return "", ReadToken{}, err
	}
	tok := ReadToken{ID: id, Name: name, Hash: s.readTokenHash(plain), CreatedAt: at}
	err = s.Update(func(st *State) error {
		st.ReadTokens = append(st.ReadTokens, tok)
		return nil
	})
	if err != nil {
		return "", ReadToken{}, err
	}
	return plain, tok, nil
}

// MatchReadToken reports which stored token plain is. Every stored hash is
// compared in constant time, so the timing tells nothing about a guess.
func (s *Store) MatchReadToken(plain string) (ReadToken, bool) {
	if plain == "" {
		return ReadToken{}, false
	}
	want := []byte(s.readTokenHash(plain))
	var found ReadToken
	ok := false
	for _, t := range s.Get().ReadTokens {
		if hmac.Equal(want, []byte(t.Hash)) {
			found, ok = t, true
		}
	}
	return found, ok
}

// DeleteReadToken removes a token. Removing one that is not there is not an
// error.
func (s *Store) DeleteReadToken(id string) error {
	return s.Update(func(st *State) error {
		st.ReadTokens = slices.DeleteFunc(st.ReadTokens, func(t ReadToken) bool { return t.ID == id })
		return nil
	})
}

func (s *Store) readTokenHash(plain string) string {
	domain := hmac.New(sha256.New, s.key)
	domain.Write([]byte("arrowloop/read-token/v1"))
	mac := hmac.New(sha256.New, domain.Sum(nil))
	mac.Write([]byte(plain))
	return hex.EncodeToString(mac.Sum(nil))
}
