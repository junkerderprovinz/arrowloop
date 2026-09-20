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
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// The optional password. Without a hash configured, Protect passes every
// request straight through, so an upgrade never locks anybody out. With one,
// everything under /api/ needs a session apart from the login, the logout and
// the probe that says whether a password is required; the static files stay
// open, since a browser refused index.html would have nowhere to type a
// password. Sessions live in memory only, so a restart logs everybody out
// rather than leaving a file of live credentials beside the configuration.

// PasswordHashEnv names the environment variable the password hash arrives
// through. It is not a key in arrowloop.json, because the API serves that
// file, downloads it as a backup and replaces it wholesale, and restoring an
// old backup would switch the protection off.
const PasswordHashEnv = "ARROWLOOP_PASSWORD_HASH"

// sessionCookieName is named for the application, since a cookie is scoped by
// host and path but not by port.
const sessionCookieName = "arrowloop_session"

const (
	// maxSessions caps how many logins are remembered at once; every entry is
	// scanned on every protected request.
	maxSessions = 32

	// failedLoginDelay is charged to every wrong password. Parallel
	// connections pay it in parallel, so the counter below is the real limit.
	failedLoginDelay = 200 * time.Millisecond

	// maxFailedLogins is how many wrong passwords one source address may try
	// before the login route stops checking passwords from it.
	maxFailedLogins = 5

	// lockoutWindow is how long that refusal lasts, measured from the most
	// recent failure, so hammering extends it.
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
	// The hash is read once, so clearing the variable at run time cannot
	// switch the protection off.
	once sync.Once
	hash []byte

	mu       sync.Mutex
	sessions []session
	failures map[string]failureRecord
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

// resolveHash works out, once, whether this install has a password.
func (g *authGate) resolveHash() []byte {
	g.once.Do(func() {
		if h := strings.TrimSpace(os.Getenv(PasswordHashEnv)); h != "" {
			g.hash = []byte(h)
		}
	})
	return g.hash
}

// passwordHash returns the configured hash, or nothing when no password is set.
func (s *Server) passwordHash() []byte {
	return s.gate().resolveHash()
}

// HashPassword turns a password into the string that belongs in
// ARROWLOOP_PASSWORD_HASH, so nobody has to paste a password into a web page
// to get one. bcrypt refuses more than 72 bytes rather than truncating.
func HashPassword(plain string) (string, error) {
	if strings.TrimSpace(plain) == "" {
		return "", errors.New("an empty password is the same as no password, which is what leaving the hash unset already does")
	}
	out, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
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
	case "/api/login", "/api/logout", "/api/session":
		// The probe tells the interface whether to draw a login screen, and
		// the logout can only destroy the caller's own token, which may just
		// have expired.
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

// clientKey is the source address a failed login is counted against: the
// socket's peer address, never X-Forwarded-For, which the caller writes and
// could change to get a fresh rate-limit bucket each time.
func clientKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// lockedOut reports how much longer this source address has to wait. It is
// counted per address, so somebody failing on purpose locks out only himself
// and not the owner.
func (g *authGate) lockedOut(key string) (time.Duration, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
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

// recordFailure counts one wrong password against a source address.
func (g *authGate) recordFailure(key string) {
	g.mu.Lock()
	defer g.mu.Unlock()
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

// clearFailures forgets a source address's failures once it gets the password
// right, so somebody who mistypes twice and then succeeds is not left one slip
// away from a lockout for the rest of the minute.
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

// loginRequest is the one field the login takes.
type loginRequest struct {
	Password string `json:"password"`
}

// login checks a password and hands back a session cookie.
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	hash := s.passwordHash()
	if len(hash) == 0 {
		// Nothing to log in to, answered rather than refused.
		writeJSON(w, http.StatusOK, sessionView{Required: false, Authenticated: true})
		return
	}

	gate := s.gate()
	key := clientKey(r)
	// Checked before bcrypt, which is expensive on purpose and would otherwise
	// let a locked-out caller spend this machine's processor.
	if wait, locked := gate.lockedOut(key); locked {
		seconds := int(wait.Seconds()) + 1
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		writeError(w, http.StatusTooManyRequests, fmt.Errorf("too many wrong passwords, try again in %d seconds", seconds))
		return
	}

	var req loginRequest
	// Capped, since anybody who can reach the port can send this body.
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}

	if err := bcrypt.CompareHashAndPassword(hash, []byte(req.Password)); err != nil {
		gate.recordFailure(key)
		// The request's context is ignored, so hanging up does not skip the
		// delay.
		time.Sleep(failedLoginDelay)
		// The same words whatever went wrong, so a malformed hash cannot be told
		// from a wrong password.
		writeError(w, http.StatusUnauthorized, errors.New("wrong password"))
		return
	}

	token, err := gate.remember()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	gate.clearFailures(key)
	http.SetCookie(w, sessionCookie(r, token))
	writeJSON(w, http.StatusOK, sessionView{Required: true, Authenticated: true})
}

// logout destroys the caller's session and clears the cookie.
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.gate().forget(cookieToken(r))

	// A browser matches a deletion by name, path and domain, so the clearing
	// cookie carries the original's attributes.
	gone := sessionCookie(r, "")
	gone.MaxAge = -1
	gone.Expires = time.Unix(0, 0)
	http.SetCookie(w, gone)

	writeJSON(w, http.StatusOK, sessionView{Required: len(s.passwordHash()) > 0, Authenticated: false})
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
