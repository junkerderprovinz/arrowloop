package web

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"

	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// softKey is a passkey held in memory, which signs the way a browser's
// authenticator would.
type softKey struct {
	id   []byte
	priv *ecdsa.PrivateKey
}

// addSoftKey registers a fresh key for localhost straight in the store.
func addSoftKey(t *testing.T, s *Server, store *security.Store) (softKey, security.Passkey) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key := softKey{id: make([]byte, 16), priv: priv}
	rand.Read(key.id)
	pub, err := webauthncbor.Marshal(webauthncose.EC2PublicKeyData{
		PublicKeyData: webauthncose.PublicKeyData{KeyType: int64(webauthncose.EllipticKey), Algorithm: int64(webauthncose.AlgES256)},
		Curve:         int64(webauthncose.P256),
		XCoord:        priv.X.FillBytes(make([]byte, 32)),
		YCoord:        priv.Y.FillBytes(make([]byte, 32)),
	})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := store.AddPasskey(security.Passkey{Name: "test key", CredentialID: key.id, PublicKey: pub, RPID: "localhost"},
		s.passwordFingerprint(), store.Get().Epoch)
	if err != nil {
		t.Fatal(err)
	}
	return key, saved
}

// asLocalhost sends a request as a browser on localhost would, the one
// address an httptest server can carry a passkey on.
func asLocalhost(t *testing.T, srv *httptest.Server, path string, body any) (*http.Response, []byte) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, srv.URL+path, strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "localhost" + srv.URL[strings.LastIndex(srv.URL, ":"):]
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	said, _ := io.ReadAll(resp.Body)
	return resp, said
}

// signIn runs a passkey sign-in with key from start to finish.
func (key softKey) signIn(t *testing.T, srv *httptest.Server) (*http.Response, string) {
	t.Helper()
	resp, said := asLocalhost(t, srv, "/api/passkeys/login/begin", map[string]any{})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("begin: %s %s", resp.Status, said)
	}
	var begun struct {
		CeremonyID string `json:"ceremonyId"`
		Options    struct {
			Challenge string `json:"challenge"`
		} `json:"options"`
	}
	if err := json.Unmarshal(said, &begun); err != nil {
		t.Fatal(err)
	}
	origin := "http://localhost" + srv.URL[strings.LastIndex(srv.URL, ":"):]
	clientData, _ := json.Marshal(map[string]string{"type": "webauthn.get", "challenge": begun.Options.Challenge, "origin": origin})
	rpHash := sha256.Sum256([]byte("localhost"))
	// User present and verified, and a counter of one.
	authData := append(rpHash[:], 0x05)
	authData = binary.BigEndian.AppendUint32(authData, 1)
	clientHash := sha256.Sum256(clientData)
	digest := sha256.Sum256(append(append([]byte{}, authData...), clientHash[:]...))
	sig, err := ecdsa.SignASN1(rand.Reader, key.priv, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	b64 := base64.RawURLEncoding.EncodeToString
	resp, said = asLocalhost(t, srv, "/api/passkeys/login/finish", map[string]any{
		"ceremonyId": begun.CeremonyID,
		"credential": map[string]any{
			"id": b64(key.id), "rawId": b64(key.id), "type": "public-key",
			"response": map[string]string{
				"clientDataJSON":    b64(clientData),
				"authenticatorData": b64(authData),
				"signature":         b64(sig),
			},
		},
	})
	return resp, string(said)
}

func resetWithTheLogCode(t *testing.T, s *Server, srv *httptest.Server) {
	t.Helper()
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	if code, said := post(t, browser(t), srv.URL+"/api/security/reset/finish", map[string]any{"code": liveCode(s), "password": resetPassword}); code != http.StatusOK {
		t.Fatalf("the reset answered %d: %s", code, said)
	}
}

func TestASoftKeySignsIn(t *testing.T) {
	s, srv, store, _ := resettable(t)
	key, _ := addSoftKey(t, s, store)
	if resp, said := key.signIn(t, srv); resp.StatusCode != http.StatusOK {
		t.Fatalf("the sign-in answered %s: %s", resp.Status, said)
	}
}

func TestAPasswordSignInOvertakenByAResetGetsNoSession(t *testing.T) {
	s, srv, _, _ := resettable(t)
	s.checked = func() { resetWithTheLogCode(t, s, srv) }

	resp, said := attemptLogin(t, srv, browser(t), uiPassword)
	if resp.StatusCode == http.StatusOK {
		t.Errorf("a sign-in checked against the old password got a session after the reset: %s", said)
	}
	for _, c := range resp.Cookies() {
		if c.Name == sessionCookieName && c.Value != "" && s.gate().accepts(c.Value) {
			t.Error("the session handed out is accepted")
		}
	}
}

func TestAPasskeySignInOvertakenByAResetGetsNoSession(t *testing.T) {
	s, srv, store, _ := resettable(t)
	key, _ := addSoftKey(t, s, store)
	s.checked = func() { resetWithTheLogCode(t, s, srv) }

	if resp, said := key.signIn(t, srv); resp.StatusCode == http.StatusOK {
		t.Errorf("a passkey the reset removed signed in: %s", said)
	}
}

func TestAPasskeyRemovedDuringItsSignInGetsNoSession(t *testing.T) {
	s, srv, store, _ := resettable(t)
	key, saved := addSoftKey(t, s, store)
	s.checked = func() {
		if err := store.DeletePasskey(saved.ID); err != nil {
			t.Error(err)
		}
	}

	if resp, said := key.signIn(t, srv); resp.StatusCode == http.StatusOK {
		t.Errorf("a passkey removed during its sign-in signed in: %s", said)
	}
}
