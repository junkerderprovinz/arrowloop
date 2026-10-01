package web

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// The optional password. Without one, Protect passes every request straight
// through, so an upgrade never locks anybody out. With one, everything under
// /api/ needs a session apart from the routes that sign somebody in; the static
// files stay open, since a browser refused index.html would have nowhere to
// type a password. Sessions live in memory only, so a restart logs everybody
// out rather than leaving a file of live credentials beside the configuration.
//
// The password is set in the interface and kept in security.json, or it
// arrives through PasswordHashEnv, which wins.

// PasswordHashEnv names the environment variable a password hash can arrive
// through. It overrides the password set in the interface, which makes it the
// way back in for somebody who forgot that one. It is not a key in
// arrowloop.json, because the API serves that file, downloads it as a backup
// and replaces it wholesale, and restoring an old backup would switch the
// protection off.
const PasswordHashEnv = "ARROWLOOP_PASSWORD_HASH"

// TrustedProxiesEnv names the environment variable that lists the reverse
// proxies in front of the server, as addresses or CIDR ranges separated by
// commas. Without it every login through a proxy counts against the proxy's
// address, so a stranger's wrong passwords lock the owner out as well.
const TrustedProxiesEnv = "ARROWLOOP_TRUSTED_PROXIES"

// sessionCookieName is named for the application, since a cookie is scoped by
// host and path but not by port.
const sessionCookieName = "arrowloop_session"

const (
	// maxSessions caps how many logins are remembered at once; every entry is
	// scanned on every protected request.
	maxSessions = 32

	// failedLoginDelay is charged to every wrong password or code. Parallel
	// connections pay it in parallel, so the counter below is the real limit.
	failedLoginDelay = 200 * time.Millisecond

	// maxFailedLogins is how many wrong answers one source address may give
	// before the login routes stop checking anything from it.
	maxFailedLogins = 5

	// lockoutWindow is how long that refusal lasts, measured from the last
	// try that was counted. A refused try is not counted, so it does not
	// extend the wait.
	lockoutWindow = time.Minute

	// maxTrackedClients bounds the failure table, which anybody who can reach
	// the port writes to.
	maxTrackedClients = 1024
)

// sessionLifetime is how long one login lasts. It is absolute rather than
// sliding, so a copied token cannot be kept alive by using it. It is a variable
// so a test can reach the expiry path.
var sessionLifetime = 12 * time.Hour

// session is one live login.
type session struct {
	token   string
	expires time.Time
}

// failureRecord is what one source address has got wrong lately.
type failureRecord struct {
	count int
	last  time.Time
}

// authGate holds everything the password gate remembers for one server.
type authGate struct {
	// The variable is read once, so clearing it at run time cannot switch the
	// protection off.
	once    sync.Once
	envHash []byte

	proxiesOnce sync.Once
	proxies     []netip.Prefix

	mu         sync.Mutex
	sessions   []session
	failures   map[string]failureRecord
	ceremonies map[string]passkeyCeremony
}

// gates maps each server to its own gate, so two servers in one process never
// accept each other's tokens. It lives beside Server because a gate holds a
// mutex, which as a field would make Server uncopyable.
var gates sync.Map

// gate returns this server's gate, creating it on first use.
func (s *Server) gate() *authGate {
	if g, ok := gates.Load(s); ok {
		return g.(*authGate)
	}
	g, _ := gates.LoadOrStore(s, &authGate{})
	return g.(*authGate)
}

// fromEnv returns the hash from the environment, or nothing.
func (g *authGate) fromEnv() []byte {
	g.once.Do(func() {
		if h := strings.TrimSpace(os.Getenv(PasswordHashEnv)); h != "" {
			g.envHash = []byte(h)
		}
	})
	return g.envHash
}

// passwordHash returns the hash in force, or nothing when no password is set.
func (s *Server) passwordHash() []byte {
	if h := s.gate().fromEnv(); len(h) > 0 {
		return h
	}
	if s.Security != nil {
		if h := s.Security.Get().PasswordHash; h != "" {
			return []byte(h)
		}
	}
	return nil
}

// Where the password in force comes from, as the interface is told.
const (
	passwordNone = "none"
	passwordFile = "file"
	passwordEnv  = "env"
)

func (s *Server) passwordSource() string {
	if len(s.gate().fromEnv()) > 0 {
		return passwordEnv
	}
	if s.Security != nil && s.Security.Get().PasswordHash != "" {
		return passwordFile
	}
	return passwordNone
}

// twoFactorOn reports whether a login needs a code as well as the password.
func (s *Server) twoFactorOn() bool {
	return s.Security != nil && s.Security.Get().TOTP.Enabled
}

// HashPassword turns a password into a bcrypt hash, the form both the
// interface and ARROWLOOP_PASSWORD_HASH keep. bcrypt refuses more than 72
// bytes rather than truncating.
func HashPassword(plain string) (string, error) {
	if strings.TrimSpace(plain) == "" {
		return "", errors.New("an empty password is the same as no password, which is what leaving the hash unset already does")
	}
	out, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if errors.Is(err, bcrypt.ErrPasswordTooLong) {
		return "", errors.New("the password is longer than 72 bytes, which bcrypt cannot hash")
	}
	if err != nil {
		return "", fmt.Errorf("hash the password: %w", err)
	}
	return string(out), nil
}

// needsSession decides whether one address is behind the lock. The path is
// cleaned first, so "/api/login/../jobs" stays protected and "//api/jobs" is
// still seen as an API path without relying on the mux to redirect it.
func needsSession(rawPath string) bool {
	p := rawPath
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	p = path.Clean(p)

	if p != "/api" && !strings.HasPrefix(p, "/api/") {
		return false
	}
	switch p {
	case "/api/login", "/api/logout", "/api/session",
		"/api/passkeys", "/api/passkeys/login/begin", "/api/passkeys/login/finish":
		// The probe tells the interface whether to draw a login screen, and
		// the logout can only destroy the caller's own token, which may just
		// have expired. The passkey probe answers a stranger with counts only,
		// and its two login halves are how a passkey signs somebody in.
		return false
	}
	return true
}

// Protect wraps a handler so the API needs a session once a password is set.
// With no password it passes every request straight through.
func (s *Server) Protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(s.passwordHash()) == 0 {
			next.ServeHTTP(w, r)
			return
		}
		if !needsSession(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		if !s.gate().accepts(cookieToken(r)) {
			// No WWW-Authenticate header, which would open the browser's own
			// credential box.
			writeError(w, http.StatusUnauthorized, errors.New("this interface is password protected, log in first"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// cookieToken pulls the session token out of a request, or an empty string.
func cookieToken(r *http.Request) string {
	c, err := r.Cookie(sessionCookieName)
	if err != nil {
		return ""
	}
	return c.Value
}

// accepts reports whether a token names a live session on this server. Every
// token is compared in constant time with no early exit, so the timing reveals
// neither how much of a guess was right nor which session matched.
func (g *authGate) accepts(token string) bool {
	if token == "" {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()

	now := time.Now()
	found := false
	kept := g.sessions[:0]
	for _, sess := range g.sessions {
		if !now.Before(sess.expires) {
			continue
		}
		kept = append(kept, sess)
		if subtle.ConstantTimeCompare([]byte(sess.token), []byte(token)) == 1 {
			found = true
		}
	}
	g.sessions = kept
	return found
}

// remember mints a session and returns its token.
func (g *authGate) remember() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("draw a session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)

	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.sessions) >= maxSessions {
		// Oldest first, which is the order they were appended in.
		g.sessions = g.sessions[len(g.sessions)-maxSessions+1:]
	}
	g.sessions = append(g.sessions, session{token: token, expires: time.Now().Add(sessionLifetime)})
	return token, nil
}

// forget drops the session a token names, if it names one.
func (g *authGate) forget(token string) {
	if token == "" {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	kept := g.sessions[:0]
	for _, sess := range g.sessions {
		if subtle.ConstantTimeCompare([]byte(sess.token), []byte(token)) == 1 {
			continue
		}
		kept = append(kept, sess)
	}
	g.sessions = kept
}

// forgetAll ends every session. Somebody changing a password because it may
// have leaked expects the sessions opened with it to end too.
func (g *authGate) forgetAll() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.sessions = nil
}

// lockoutKey is the source address a failed login from r is counted against.
func (s *Server) lockoutKey(r *http.Request) string {
	g := s.gate()
	g.proxiesOnce.Do(func() {
		var bad []string
		g.proxies, bad = parseTrustedProxies(os.Getenv(TrustedProxiesEnv))
		for _, entry := range bad {
			s.logf("%s: %q is neither an address nor a range, so it is ignored", TrustedProxiesEnv, entry)
		}
	})
	return clientKey(r, g.proxies)
}

// clientKey is the socket's peer address, unless the peer is one of the
// trusted proxies. Then it is the last address in X-Forwarded-For that is not
// a trusted proxy itself: each proxy appends the address it heard from, while
// everything to the left of that came from the client and could be changed
// for a fresh count each time.
func clientKey(r *http.Request, proxies []netip.Prefix) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || !trusted(peer, proxies) {
		return host
	}
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		hop, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			break
		}
		if !trusted(hop, proxies) {
			return hop.Unmap().String()
		}
	}
	return host
}

func trusted(addr netip.Addr, proxies []netip.Prefix) bool {
	addr = addr.Unmap()
	for _, p := range proxies {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

// parseTrustedProxies reads a comma-separated list of addresses and CIDR
// ranges, and returns the entries it could not read apart.
func parseTrustedProxies(list string) (proxies []netip.Prefix, bad []string) {
	for _, entry := range strings.Split(list, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if p, err := netip.ParsePrefix(entry); err == nil {
			proxies = append(proxies, p.Masked())
			continue
		}
		if a, err := netip.ParseAddr(entry); err == nil {
			a = a.Unmap()
			proxies = append(proxies, netip.PrefixFrom(a, a.BitLen()))
			continue
		}
		bad = append(bad, entry)
	}
	return proxies, bad
}

// lockedOut reports how much longer this source address has to wait. It is
// counted per address, so somebody failing on purpose locks out only himself
// and not the owner. The caller holds g.mu.
func (g *authGate) lockedOut(key string) (time.Duration, bool) {
	rec, ok := g.failures[key]
	if !ok || rec.count < maxFailedLogins {
		return 0, false
	}
	if wait := time.Until(rec.last.Add(lockoutWindow)); wait > 0 {
		return wait, true
	}
	delete(g.failures, key)
	return 0, false
}

// attempt is one try at a password or code. It counts as a failure from the
// moment it is admitted, because requests sent at once would otherwise all
// pass the check before the first wrong answer is recorded.
type attempt struct {
	gate    *authGate
	key     string
	settled bool
}

// admit counts one try against a source address, or answers 429 and reports
// false when the address has used up its tries. It runs before any hash or
// code is checked, so a locked-out caller spends none of this machine's
// processor. The caller defers done.
func (g *authGate) admit(w http.ResponseWriter, key string) (*attempt, bool) {
	g.mu.Lock()
	wait, locked := g.lockedOut(key)
	if !locked {
		g.recordFailure(key)
	}
	g.mu.Unlock()

	if locked {
		seconds := int(wait.Seconds()) + 1
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		writeError(w, http.StatusTooManyRequests, fmt.Errorf("too many wrong attempts, try again in %d seconds", seconds))
		return nil, false
	}
	return &attempt{gate: g, key: key}, true
}

// fail keeps the try counted and charges the delay. The request's context is
// ignored, so hanging up does not skip the delay.
func (a *attempt) fail() {
	a.settled = true
	time.Sleep(failedLoginDelay)
}

// succeed forgets the address's failures, so somebody who mistypes twice and
// then gets it right is not left one slip away from a lockout for the rest of
// the minute.
func (a *attempt) succeed() {
	a.settled = true
	a.gate.clearFailures(a.key)
}

// done takes back a try that was neither failed nor succeeded, such as one
// whose body could not be read or a right password that still needs its code.
func (a *attempt) done() {
	if a.settled {
		return
	}
	a.gate.mu.Lock()
	defer a.gate.mu.Unlock()
	rec, ok := a.gate.failures[a.key]
	if !ok {
		return
	}
	rec.count--
	if rec.count <= 0 {
		delete(a.gate.failures, a.key)
		return
	}
	a.gate.failures[a.key] = rec
}

// recordFailure counts one wrong answer against a source address. The caller
// holds g.mu.
func (g *authGate) recordFailure(key string) {
	if g.failures == nil {
		g.failures = map[string]failureRecord{}
	}

	now := time.Now()
	for k, rec := range g.failures {
		if now.Sub(rec.last) > lockoutWindow {
			delete(g.failures, k)
		}
	}
	// A flood of distinct addresses defeats a per-address limit anyway, so the
	// table is dropped rather than allowed to exhaust memory.
	if len(g.failures) >= maxTrackedClients {
		g.failures = map[string]failureRecord{}
	}

	rec := g.failures[key]
	rec.count++
	rec.last = now
	g.failures[key] = rec
}

// clearFailures forgets a source address's failures.
func (g *authGate) clearFailures(key string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.failures, key)
}

// sessionView is what the interface reads to decide what to draw.
type sessionView struct {
	// Required says whether this install has a password at all.
	Required bool `json:"required"`

	// Authenticated says whether this request already has a session. It is
	// true when no password is required.
	Authenticated bool `json:"authenticated"`

	// NeedCode answers a right password on an install with a second factor:
	// the login screen asks for the code next.
	NeedCode bool `json:"needCode,omitempty"`
}

// session answers whether a password is needed and whether the caller has one.
// Any other route would reveal that a password exists by refusing.
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	if len(s.passwordHash()) == 0 {
		writeJSON(w, http.StatusOK, sessionView{Required: false, Authenticated: true})
		return
	}
	writeJSON(w, http.StatusOK, sessionView{Required: true, Authenticated: s.gate().accepts(cookieToken(r))})
}

// loginRequest is what the login takes. Code is the six digits from the
// authenticator app or a recovery code, and is read only when the second
// factor is on.
type loginRequest struct {
	Password string `json:"password"`
	Code     string `json:"code,omitempty"`
}

// readBody decodes a small JSON body, capped, since anybody who can reach the
// port can send one to the login routes. It answers 400 itself and reports
// whether decoding worked.
func readBody(w http.ResponseWriter, r *http.Request, into any) bool {
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(into); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return false
	}
	return true
}

// login checks a password, and the code when a second factor is on, and hands
// back a session cookie.
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	hash := s.passwordHash()
	if len(hash) == 0 {
		// Nothing to log in to, answered rather than refused.
		writeJSON(w, http.StatusOK, sessionView{Required: false, Authenticated: true})
		return
	}

	gate := s.gate()
	key := s.lockoutKey(r)
	// Checked before bcrypt, which is expensive on purpose and would otherwise
	// let a locked-out caller spend this machine's processor.
	try, ok := gate.admit(w, key)
	if !ok {
		return
	}
	defer try.done()

	var req loginRequest
	if !readBody(w, r, &req) {
		return
	}

	if err := bcrypt.CompareHashAndPassword(hash, []byte(req.Password)); err != nil {
		try.fail()
		// The same words whatever went wrong, so a malformed hash cannot be told
		// from a wrong password.
		writeError(w, http.StatusUnauthorized, errors.New("wrong password"))
		return
	}

	// With a second factor on, a right password alone grants nothing, and the
	// failure count is not cleared either, so somebody who has the password
	// still gets five tries a minute at the code.
	if s.twoFactorOn() {
		if strings.TrimSpace(req.Code) == "" {
			// Not a failure: the answer tells the interface to show the code
			// field.
			writeJSON(w, http.StatusOK, sessionView{Required: true, NeedCode: true})
			return
		}
		if !s.secondFactorOK(req.Code) {
			try.fail()
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "wrong code", "needCode": true})
			return
		}
	}

	if err := s.startSession(w, r); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	try.succeed()
	writeJSON(w, http.StatusOK, sessionView{Required: true, Authenticated: true})
}

// startSession mints a session and sets its cookie.
func (s *Server) startSession(w http.ResponseWriter, r *http.Request) error {
	token, err := s.gate().remember()
	if err != nil {
		return err
	}
	http.SetCookie(w, sessionCookie(r, token))
	return nil
}

// errNoMatch ends an Update that found nothing to change.
var errNoMatch = errors.New("no match")

// secondFactorOK checks a code against the authenticator secret and then
// against the recovery codes. An accepted code is spent in the same write that
// checks it: a time step is recorded so the code cannot be replayed within its
// window, and a recovery code is removed. When that write fails the login is
// refused, because a recovery code that survives its own use is a permanent
// second password.
func (s *Server) secondFactorOK(code string) bool {
	if s.Security == nil {
		return false
	}
	err := s.Security.Update(func(st *security.State) error {
		if step, ok := security.MatchTOTP(st.TOTP.Secret, code, time.Now()); ok && step > st.TOTP.LastStep {
			st.TOTP.LastStep = step
			return nil
		}
		i := security.MatchRecoveryCode(code, st.TOTP.Recovery)
		if i < 0 {
			return errNoMatch
		}
		st.TOTP.Recovery = append(st.TOTP.Recovery[:i], st.TOTP.Recovery[i+1:]...)
		s.logf("a recovery code was used, %d left", len(st.TOTP.Recovery))
		return nil
	})
	if err != nil && !errors.Is(err, errNoMatch) {
		s.logf("could not record a used login code, so it was refused: %v", err)
	}
	return err == nil
}

// logout destroys the caller's session and clears the cookie.
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.gate().forget(cookieToken(r))
	clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, sessionView{Required: len(s.passwordHash()) > 0, Authenticated: false})
}

// clearSessionCookie tells the browser to drop its session cookie. A browser
// matches a deletion by name, path and domain, so the clearing cookie carries
// the original's attributes.
func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	gone := sessionCookie(r, "")
	gone.MaxAge = -1
	gone.Expires = time.Unix(0, 0)
	http.SetCookie(w, gone)
}

// sessionCookie builds the cookie a session travels in.
//
// HttpOnly keeps the token from a script, should a path or job name from disk
// ever reach the page unescaped. SameSite=Lax withholds it from POST, PUT and
// DELETE requests another site starts, while a top-level GET, which only
// reads, keeps bookmarks working. Secure is set only over TLS, because an
// always-secure cookie would never come back on a plain HTTP home network.
func sessionCookie(r *http.Request, token string) *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
		MaxAge:   int(sessionLifetime / time.Second),
	}
}
