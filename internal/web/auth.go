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

// The optional password, and the one property it must never break.
//
// Until now this interface had no login at all, which is defensible on a home
// network and indefensible anywhere else: the API can start a job that deletes
// files, so anybody who can reach the port can delete somebody's photos. The
// listener already defaults to loopback for exactly that reason, and the
// container image moves it to 0.0.0.0 because publishing the port is somebody's
// explicit decision. This adds the other half, a way to put a password in front
// of the API without changing anything for an install that does not want one.
//
// OFF BY DEFAULT is not a nicety here, it is the design constraint. An install
// with no hash configured takes the same path through this file it took before
// this file existed: one length check, no cookie, no session, no refusal. The
// failure being prevented is an upgrade that locks somebody out of his own
// machine, which is a worse outcome than the exposure it would be closing.
//
// What is protected and what is not:
//
//   - Everything under /api/ needs a session, apart from the three routes that
//     exist so a browser can get one: the login, the logout and the probe that
//     says whether a password is required at all. Without that last one the
//     interface has no way to tell "you are logged out" from "there is nothing
//     to log in to", and it would have to find out by reading a 401, which is
//     the same mistake the capabilities route was added to stop.
//   - The static files stay OPEN. The interface is HTML, CSS and JavaScript
//     that is identical on every install and reveals nothing about this one:
//     without the API behind it, it draws an empty shell and cannot read a
//     path, list a job or move a byte. Gating it would buy no secrecy and cost
//     the ability to serve a login screen from the same origin, because a
//     browser that is refused index.html has nowhere to type a password. The
//     API is the thing with the power, so the API is the thing behind the lock.
//
// The sessions live in memory and nowhere else. A restart logs everybody out,
// and that is the correct behaviour for a tool like this rather than a
// shortcoming to apologise for: the alternative is a file of live credentials
// sitting beside the configuration, which has to be written with the right
// permissions, kept out of the backup somebody takes through the raw config
// route, and invalidated by hand when it leaks. Losing a session on restart
// costs one password entry, on a daemon that restarts when its owner updates it.

// PasswordHashEnv names the environment variable the password hash arrives
// through.
//
// An environment variable rather than a key in arrowloop.json, and that is a
// decision rather than convenience: the configuration file is served by the
// API, downloaded whole as a backup and replaced wholesale by anybody who is
// already logged in. A hash living in there would be handed out over the same
// routes it protects, and restoring a backup taken before the password was set
// would quietly switch the protection off again.
const PasswordHashEnv = "ARROWLOOP_PASSWORD_HASH"

// sessionCookieName is the cookie the browser carries. Named for the
// application so that two tools on one host do not overwrite each other's
// session: a cookie is scoped by host and path, never by port.
const sessionCookieName = "arrowloop_session"

const (
	// maxSessions caps how many logins are remembered at once. Somebody with a
	// phone, a laptop and a habit of clearing cookies would otherwise grow this
	// list for the life of the process, and every entry in it is scanned on
	// every protected request.
	maxSessions = 32

	// failedLoginDelay is charged to every wrong password. It is the smaller
	// half of the answer to brute force and this comment is honest about that:
	// an attacker who opens ten connections at once pays it ten times in
	// parallel, so it slows a naive script rather than stopping a determined
	// one. The counter below is the real limit.
	failedLoginDelay = 200 * time.Millisecond

	// maxFailedLogins is how many wrong passwords one source address may try
	// before the login route stops looking at passwords from it at all.
	maxFailedLogins = 5

	// lockoutWindow is how long that refusal lasts, measured from the most
	// recent failure, so hammering during the lockout extends it rather than
	// running it out.
	lockoutWindow = time.Minute

	// maxTrackedClients bounds the failure table. It is written to by anybody
	// who can reach the port, so it cannot be allowed to grow without limit: an
	// unbounded map a stranger fills is a way to exhaust this machine's memory
	// from the network, which is a worse failure than a rate limit being reset.
	maxTrackedClients = 1024
)

// sessionLifetime is how long one login lasts.
//
// Absolute rather than sliding, so a token somebody copied cannot be kept alive
// forever by using it. A variable rather than a constant so a test can reach
// the expiry path without waiting half a day for it; nothing in the running
// program writes to it.
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
	// The hash is resolved once and then never re-read. Deliberate: looking at
	// the environment on every request would mean the protection could be
	// switched off while the program runs by whatever cleared the variable, and
	// a lock that comes off without a restart is not much of a lock.
	once sync.Once
	hash []byte

	mu       sync.Mutex
	sessions []session
	failures map[string]failureRecord
}

// gates maps each server to its own gate.
//
// Beside the Server rather than inside it for two reasons, and the second is
// the one that matters. A gate holds a mutex and a sync.Once, so a field would
// make Server uncopyable and turn every future `*s` into a vet failure in code
// that has nothing to do with passwords. And the sessions have to be PER
// SERVER: two servers in one process must not accept each other's tokens,
// which is not a theoretical worry, because the tests already stand several
// servers up on one engine and a shared token store would pass every one of
// them while being wrong.
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

// passwordHash is the one question the rest of this file asks: is there a
// password, and what does it hash to. An empty answer is the untouched install.
func (s *Server) passwordHash() []byte {
	return s.gate().resolveHash()
}

// HashPassword turns a password into the string that belongs in
// ARROWLOOP_PASSWORD_HASH.
//
// Exported so a command can offer it. Asking somebody to produce a bcrypt hash
// with a tool they have to go and find first is asking them to paste their
// password into a web page, and a password that has been through a stranger's
// server is not a password any more.
//
// bcrypt refuses anything past 72 bytes rather than silently ignoring the tail,
// which is the behaviour worth having: quietly truncating would make two
// different long passphrases interchangeable, and the person who chose the
// longer one would never learn that the extra words did nothing.
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

// needsSession decides whether one address is behind the lock.
//
// The path is cleaned first, and that cleaning is part of the guard rather than
// a tidy-up. Only an EXACT match on one of the three open routes is let
// through, so anything dressed up to look like one ("/api/login/../jobs") stays
// protected; and the prefix test is applied to the cleaned form so nothing
// dressed up to look unlike an API path ("//api/jobs") slips past it. Go's own
// mux happens to answer that second shape with a redirect today, but a guard
// that leans on the routing behaviour of another package is a guard that breaks
// silently on the day that package changes its mind.
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
		// The login is open for the obvious reason. The probe is open because
		// the interface has to be able to ask whether a password exists at all
		// before it can decide whether to draw a login screen. The logout is
		// open because it can only ever destroy the token the caller already
		// presents, so demanding a valid session before letting somebody give
		// one up would refuse exactly the people whose session just expired.
		return false
	}
	return true
}

// Protect wraps a handler so the API needs a session once a password is set.
//
// The first branch is the promise at the top of this file: with no password
// configured this returns the wrapped handler's own answer after one length
// check, and every route behaves precisely as it did before any of this existed.
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
			// No WWW-Authenticate header, on purpose. Sending one makes the
			// browser open its own credential box, which is a dialogue the
			// interface cannot style, cannot explain and cannot log out of.
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

// accepts reports whether a token names a live session on THIS server.
//
// Every remembered token is compared, always, with no early exit on a match and
// with crypto/subtle rather than ==. That is the entire point of the function.
// A plain string comparison stops at the first byte that differs, so the time it
// takes says how much of the guess was right, and somebody who can measure that
// recovers the token one byte at a time instead of guessing 256 bits at once.
// Ranging over the whole list rather than breaking on the match keeps the answer
// from depending on WHICH session matched either.
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
			// Expired, so it is dropped here rather than by a sweeper somebody
			// would have to remember to start.
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
		// A token that is not random is not a token. Failing the login is the
		// only safe answer here, because the alternative is handing out
		// something guessable and calling it a session.
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

// clientKey is the source address a failed login is counted against.
//
// The socket's own peer address, never X-Forwarded-For. That header is written
// by whoever is talking to us, unless a proxy in front is known to overwrite it,
// and this program has no way to know that it is. Trusting it would hand an
// attacker an unlimited supply of fresh rate-limit buckets for the price of
// typing a different number into a header, which turns the limit below into
// decoration.
func clientKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// lockedOut reports how much longer this source address has to wait.
//
// Counted per source address rather than once for the whole server, and the
// reason is the property at the top of this file. A single counter would let
// anybody who can reach the port keep the OWNER out of his own interface
// indefinitely by failing on purpose, which turns a defence against brute force
// into a denial of service that any passer-by can run. Per address, somebody
// hammering the login locks out only himself.
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
	// A flood of distinct source addresses is already an attack no per-address
	// limit can answer, and remembering every one of them is how it becomes a
	// memory problem as well. Dropping the table is the lesser failure: it
	// loses the counts, it does not lose the service.
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

	// Authenticated says whether THIS request already has a session. True when
	// nothing is required, because the honest answer to "may I use the API" on
	// an install with no password is yes.
	Authenticated bool `json:"authenticated"`
}

// session answers whether a password is needed and whether the caller has one.
//
// Open to everybody, and it gives nothing away that is worth keeping: a caller
// with no session already learns that a password exists the first time one of
// the other routes refuses him.
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
		// There is nothing to log in to. Answered rather than refused, because
		// an interface that offers a login form on an install with no password
		// would otherwise reach a dead end, and a 404 here reads like a broken
		// build rather than like an open door.
		writeJSON(w, http.StatusOK, sessionView{Required: false, Authenticated: true})
		return
	}

	gate := s.gate()
	key := clientKey(r)
	// Checked BEFORE the body is read and long before bcrypt is asked anything.
	// The hash is deliberately expensive to verify, so letting a locked-out
	// caller reach that verification would turn the login route into a way to
	// spend this machine's processor on demand.
	if wait, locked := gate.lockedOut(key); locked {
		seconds := int(wait.Seconds()) + 1
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		writeError(w, http.StatusTooManyRequests, fmt.Errorf("too many wrong passwords, try again in %d seconds", seconds))
		return
	}

	var req loginRequest
	// Capped, because this is an unauthenticated route: the body comes from
	// anybody who can reach the port, a password is short, and an uncapped read
	// is a way to be handed a gigabyte by somebody who has no password at all.
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}

	if err := bcrypt.CompareHashAndPassword(hash, []byte(req.Password)); err != nil {
		gate.recordFailure(key)
		// Slept without watching the request's context, on purpose. A caller who
		// hangs up would otherwise skip the delay entirely by disconnecting,
		// which costs a script nothing and would leave the delay being paid only
		// by the people who wait politely for their answer.
		time.Sleep(failedLoginDelay)
		// The same words whatever went wrong. A message that distinguished a
		// malformed hash from a wrong password would be a way to ask questions
		// about this install without answering any.
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

	// The clearing cookie carries the same attributes the original was set
	// with. A browser matches a deletion by name, path and domain, so a
	// clearing cookie that disagrees about the path leaves the original sitting
	// there and the person is still logged in on the next reload.
	gone := sessionCookie(r, "")
	gone.MaxAge = -1
	gone.Expires = time.Unix(0, 0)
	http.SetCookie(w, gone)

	writeJSON(w, http.StatusOK, sessionView{Required: len(s.passwordHash()) > 0, Authenticated: false})
}

// sessionCookie builds the cookie a session travels in.
//
// HttpOnly, so a script on the page cannot read the token: this interface draws
// paths and job names that came off somebody's disk, and on the day one of them
// reaches the document unescaped, a readable token would turn a display bug into
// a stolen session.
//
// SameSite=Lax, so a form on another site cannot post to this one with the
// cookie attached. Everything here that changes anything is a POST, a PUT or a
// DELETE, and Lax withholds the cookie from all three when the request comes
// from somewhere else. It does still send the cookie on a top-level GET
// navigation, which is the deliberate half of the trade: it keeps a bookmark
// working, and a GET here only reads, with the same-origin policy stopping the
// other site from seeing what came back.
//
// Secure only when the request itself arrived over TLS. Setting it always would
// mean the browser never sends the cookie back over plain HTTP, so the password
// would be accepted and then appear to do nothing whatsoever on exactly the home
// network this tool is usually run on. Over plain HTTP the token does cross the
// wire in the clear, which is the same exposure the password itself already has
// and one only TLS in front of this can close.
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
