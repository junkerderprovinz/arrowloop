package web

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// Passkeys are a second way to sign in and never replace the password: a lost
// phone must not lock anybody out of a program that deletes files on command.
//
// WebAuthn binds a key to a relying-party id, which has to be a host name, and
// browsers allow the exchange only on a secure page: HTTPS with a certificate
// they trust, or localhost. An install opened as http://192.168.1.5:8422 is
// neither, so passkeys work behind a reverse proxy with a real name, or
// through a tunnel to localhost.

// passkeyCeremony is one registration or login in progress. It lives in memory
// only: it expires within minutes, and a restart costs a second click at most.
type passkeyCeremony struct {
	session webauthn.SessionData
	rpID    string
	expires time.Time
}

const (
	// passkeyCeremonyTTL bounds how long a started ceremony can be finished.
	// The browser's own prompt usually gives up sooner.
	passkeyCeremonyTTL = 5 * time.Minute

	// passkeyCeremonyMax caps the table, because a login ceremony can be
	// started without a session.
	passkeyCeremonyMax = 64
)

// beginCeremony stores the session data and returns the random, single-use
// handle the finishing call has to present.
func (g *authGate) beginCeremony(sd *webauthn.SessionData, rpID string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("draw a ceremony handle: %w", err)
	}
	id := hex.EncodeToString(raw)

	g.mu.Lock()
	defer g.mu.Unlock()
	if g.ceremonies == nil {
		g.ceremonies = map[string]passkeyCeremony{}
	}
	now := time.Now()
	for k, c := range g.ceremonies {
		if now.After(c.expires) {
			delete(g.ceremonies, k)
		}
	}
	// Still full: drop the oldest. That costs somebody one more click, while an
	// unbounded table reachable without a session costs memory.
	for len(g.ceremonies) >= passkeyCeremonyMax {
		oldestKey, oldest := "", time.Time{}
		for k, c := range g.ceremonies {
			if oldest.IsZero() || c.expires.Before(oldest) {
				oldestKey, oldest = k, c.expires
			}
		}
		delete(g.ceremonies, oldestKey)
	}
	g.ceremonies[id] = passkeyCeremony{session: *sd, rpID: rpID, expires: now.Add(passkeyCeremonyTTL)}
	return id, nil
}

// takeCeremony consumes a handle, so an answered challenge cannot be replayed.
func (g *authGate) takeCeremony(id string) (passkeyCeremony, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	c, ok := g.ceremonies[id]
	if !ok {
		return passkeyCeremony{}, false
	}
	delete(g.ceremonies, id)
	if time.Now().After(c.expires) {
		return passkeyCeremony{}, false
	}
	return c, true
}

// errPasskeyOrigin refuses an address that is an IP, which is how most
// installs are opened, so it carries the whole explanation.
var errPasskeyOrigin = errors.New(
	"passkeys need a host name, and this page was opened on an IP address. " +
		"A passkey is bound to a domain and browsers refuse the whole exchange on a bare address, " +
		"and again on a page that is not HTTPS with a certificate they trust. " +
		"Reach ArrowLoop through a reverse proxy under a real name with a valid certificate, open it there, and register the key on that address")

// rpIDFor takes the relying-party id from the request's host, without the
// port. It comes from the request rather than a setting because one machine is
// often reachable several ways, and a browser offers only the keys whose id
// matches the address bar.
func rpIDFor(r *http.Request) (string, error) {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.TrimSpace(strings.Trim(host, "[]"))
	if host == "" {
		return "", errPasskeyOrigin
	}
	// Browsers treat localhost as secure and accept it as an id, so an SSH
	// tunnel works.
	if strings.EqualFold(host, "localhost") {
		return "localhost", nil
	}
	if net.ParseIP(host) != nil {
		return "", errPasskeyOrigin
	}
	return strings.ToLower(host), nil
}

// originFor rebuilds the origin the browser reports, so the library checks the
// ceremony against it. A proxy that terminates TLS forwards plain HTTP, and
// the origin has to carry the scheme the browser saw, which the proxy passes
// on in X-Forwarded-Proto. Believing that header costs nothing: whoever could
// lie in it is the browser whose own origin is being checked.
func originFor(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if fp := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); fp != "" {
		// Each proxy in a chain appends; the first value is the client's.
		if i := strings.IndexByte(fp, ','); i > 0 {
			fp = strings.TrimSpace(fp[:i])
		}
		if fp == "http" || fp == "https" {
			scheme = fp
		}
	}
	return scheme + "://" + r.Host
}

// webAuthnFor builds the library's handle for the request's address.
func webAuthnFor(r *http.Request) (*webauthn.WebAuthn, string, error) {
	rpID, err := rpIDFor(r)
	if err != nil {
		return nil, "", err
	}
	wa, err := webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: "ArrowLoop",
		RPOrigins:     []string{originFor(r)},
	})
	if err != nil {
		return nil, "", err
	}
	return wa, rpID, nil
}

// passkeyUser adapts the install to the library's user model. ArrowLoop has
// one owner and no user table, so the install is the account.
type passkeyUser struct {
	id    []byte
	creds []webauthn.Credential
}

func (u passkeyUser) WebAuthnID() []byte                         { return u.id }
func (u passkeyUser) WebAuthnName() string                       { return "arrowloop" }
func (u passkeyUser) WebAuthnDisplayName() string                { return "ArrowLoop" }
func (u passkeyUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

// passkeyUserFor builds the account with the keys registered for rpID. A
// browser refuses a key bound to another id, so offering those would raise a
// prompt that cannot succeed.
func (s *Server) passkeyUserFor(rpID string) (passkeyUser, []security.Passkey, error) {
	id, err := s.Security.PasskeyUser()
	if err != nil {
		return passkeyUser{}, nil, err
	}
	rows := s.Security.Get().PasskeysFor(rpID)
	u := passkeyUser{id: id}
	for _, p := range rows {
		u.creds = append(u.creds, webauthn.Credential{
			ID:        p.CredentialID,
			PublicKey: p.PublicKey,
			Transport: parseTransports(p.Transports),
			Flags:     webauthn.CredentialFlags{BackupEligible: p.BackedUp, BackupState: p.BackedUp},
			Authenticator: webauthn.Authenticator{
				AAGUID:    p.AAGUID,
				SignCount: p.SignCount,
			},
		})
	}
	return u, rows, nil
}

func parseTransports(s string) []protocol.AuthenticatorTransport {
	var out []protocol.AuthenticatorTransport
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, protocol.AuthenticatorTransport(p))
		}
	}
	return out
}

func joinTransports(ts []protocol.AuthenticatorTransport) string {
	out := make([]string, 0, len(ts))
	for _, t := range ts {
		if s := strings.TrimSpace(string(t)); s != "" {
			out = append(out, s)
		}
	}
	return strings.Join(out, ",")
}

// passkeyView is one key as the list shows it, without the key material.
type passkeyView struct {
	ID   string `json:"id"`
	Name string `json:"name"`

	// RPID is the address the key belongs to. A key registered through the
	// proxy does not exist over another name, which the list has to say.
	RPID string `json:"rpId"`

	// UsableHere says whether the key can answer on the address the browser
	// has open.
	UsableHere bool  `json:"usableHere"`
	BackedUp   bool  `json:"backedUp"`
	CreatedAt  int64 `json:"createdAt"`
	LastUsedAt int64 `json:"lastUsedAt"`
}

func passkeyViews(rows []security.Passkey, here string) []passkeyView {
	out := make([]passkeyView, 0, len(rows))
	for _, p := range rows {
		out = append(out, passkeyView{
			ID: p.ID, Name: p.Name, RPID: p.RPID,
			UsableHere: here != "" && p.RPID == here,
			BackedUp:   p.BackedUp, CreatedAt: p.CreatedAt, LastUsedAt: p.LastUsedAt,
		})
	}
	return out
}

// passkeyStatus is open like the session probe, because the login screen has
// to know whether to offer the button before anybody is signed in. A stranger
// gets counts; the list is for somebody signed in, or anybody while there is
// no password.
func (s *Server) passkeyStatus(w http.ResponseWriter, r *http.Request) {
	rpID, rpErr := rpIDFor(r)
	all := s.Security.Get().Passkeys
	here := 0
	for _, p := range all {
		if rpErr == nil && p.RPID == rpID {
			here++
		}
	}
	body := map[string]any{
		"supported": rpErr == nil,
		"rpId":      rpID,
		"total":     len(all),
		"here":      here,
	}
	if rpErr != nil {
		body["reason"] = rpErr.Error()
	}
	if len(s.passwordHash()) == 0 || s.gate().accepts(cookieToken(r)) {
		body["passkeys"] = passkeyViews(all, rpID)
	}
	writeJSON(w, http.StatusOK, body)
}

var errPasskeyNeedsPassword = errors.New("set a password first, a passkey is an extra way in and never the only one")

// passkeyRegisterBegin sits behind the lock: enrolling a key is something only
// somebody signed in does.
func (s *Server) passkeyRegisterBegin(w http.ResponseWriter, r *http.Request) {
	if len(s.passwordHash()) == 0 {
		writeError(w, http.StatusConflict, errPasskeyNeedsPassword)
		return
	}
	wa, rpID, err := webAuthnFor(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	user, _, err := s.passkeyUserFor(rpID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	creation, sd, err := wa.BeginRegistration(
		user,
		// Naming the keys already registered here lets the browser say so
		// itself instead of producing a duplicate this server has to refuse.
		webauthn.WithExclusions(webauthn.Credentials(user.creds).CredentialDescriptors()),
		// Discoverable keys sign in without naming an account first.
		// Preferred rather than required, so an older security key without
		// storage still works.
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationPreferred,
		}),
	)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	handle, err := s.gate().beginCeremony(sd, rpID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ceremonyId": handle, "options": creation.Response})
}

// passkeyRegisterFinish hands the browser's answer to the library as it came,
// since re-encoding it here would mean re-implementing the parsing that
// validates it.
func (s *Server) passkeyRegisterFinish(w http.ResponseWriter, r *http.Request) {
	if len(s.passwordHash()) == 0 {
		writeError(w, http.StatusConflict, errPasskeyNeedsPassword)
		return
	}
	var body struct {
		CeremonyID string          `json:"ceremonyId"`
		Name       string          `json:"name"`
		Credential json.RawMessage `json:"credential"`
	}
	if !readBody(w, r, &body) {
		return
	}
	cer, ok := s.gate().takeCeremony(body.CeremonyID)
	if !ok {
		writeError(w, http.StatusBadRequest, errors.New("that registration has expired, start it again"))
		return
	}
	wa, rpID, err := webAuthnFor(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if rpID != cer.rpID {
		writeError(w, http.StatusBadRequest, errors.New("this registration was started on another address, open the one the key should work on and start again"))
		return
	}
	user, _, err := s.passkeyUserFor(rpID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(body.Credential)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	cred, err := wa.CreateCredential(user, cer.session, parsed)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "Passkey"
	}
	saved, err := s.Security.AddPasskey(security.Passkey{
		Name:         name,
		CredentialID: cred.ID,
		PublicKey:    cred.PublicKey,
		AAGUID:       cred.Authenticator.AAGUID,
		SignCount:    cred.Authenticator.SignCount,
		Transports:   joinTransports(cred.Transport),
		RPID:         rpID,
		BackedUp:     cred.Flags.BackupEligible,
		CreatedAt:    time.Now().Unix(),
	})
	if errors.Is(err, security.ErrPasskeyExists) {
		writeError(w, http.StatusConflict, err)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.logf("passkey %q registered for %s", saved.Name, rpID)
	writeJSON(w, http.StatusOK, passkeyViews([]security.Passkey{saved}, rpID)[0])
}

// passkeyLoginBegin is open: it is one half of signing in.
func (s *Server) passkeyLoginBegin(w http.ResponseWriter, r *http.Request) {
	if len(s.passwordHash()) == 0 {
		writeError(w, http.StatusConflict, errors.New("no password is set, so there is nothing to sign in to"))
		return
	}
	wa, rpID, err := webAuthnFor(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	user, rows, err := s.passkeyUserFor(rpID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if len(rows) == 0 {
		writeError(w, http.StatusNotFound, errors.New("no passkey is registered for this address"))
		return
	}
	assertion, sd, err := wa.BeginLogin(user)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	handle, err := s.gate().beginCeremony(sd, rpID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ceremonyId": handle, "options": assertion.Response})
}

// passkeyLoginFinish checks the signed answer and, when it holds, hands out a
// session. It shares the password login's limit: a signature cannot be
// guessed, but without the limit this route would be a way around it.
func (s *Server) passkeyLoginFinish(w http.ResponseWriter, r *http.Request) {
	if len(s.passwordHash()) == 0 {
		writeError(w, http.StatusConflict, errors.New("no password is set, so there is nothing to sign in to"))
		return
	}
	gate := s.gate()
	key := clientKey(r)
	if gate.refuseIfLockedOut(w, key) {
		return
	}
	var body struct {
		CeremonyID string          `json:"ceremonyId"`
		Credential json.RawMessage `json:"credential"`
	}
	if !readBody(w, r, &body) {
		return
	}
	refuse := func(why string) {
		gate.fail(key)
		writeError(w, http.StatusUnauthorized, errors.New(why))
	}

	cer, ok := gate.takeCeremony(body.CeremonyID)
	if !ok {
		refuse("that sign-in has expired, try again")
		return
	}
	wa, rpID, err := webAuthnFor(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if rpID != cer.rpID {
		refuse("that sign-in was started on another address")
		return
	}
	user, rows, err := s.passkeyUserFor(rpID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(body.Credential)
	if err != nil {
		refuse("that passkey was not accepted")
		return
	}
	cred, err := wa.ValidateLogin(user, cer.session, parsed)
	if err != nil {
		s.logf("a passkey sign-in was refused: %v", err)
		refuse("that passkey was not accepted")
		return
	}
	// A counter that failed to move forward is the documented sign of a cloned
	// key. The library stays quiet when both counters are zero, which is how an
	// authenticator without a counter reports.
	if cred.Authenticator.CloneWarning {
		s.logf("a passkey sign-in was refused: the authenticator's counter went backwards, which is how a cloned key shows")
		refuse("that passkey was refused because its counter went backwards, which is how a copied key looks; remove it and register a new one")
		return
	}

	for _, p := range rows {
		if string(p.CredentialID) == string(cred.ID) {
			if err := s.Security.TouchPasskey(p.ID, cred.Authenticator.SignCount, time.Now().Unix()); err != nil {
				s.logf("could not record the use of passkey %q: %v", p.Name, err)
			}
			break
		}
	}

	if err := s.startSession(w, r); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	gate.clearFailures(key)
	writeJSON(w, http.StatusOK, sessionView{Required: true, Authenticated: true})
}

// deletePasskey removes one key. The password always stays, so removing every
// key locks nobody out.
func (s *Server) deletePasskey(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, errors.New("say which passkey to remove"))
		return
	}
	if err := s.Security.DeletePasskey(id); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
}
