package web

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"os"
	"path"
	"slices"
	"strings"
	"sync"

	"github.com/junkerderprovinz/parleyport/kit/group"
	"github.com/junkerderprovinz/parleyport/kit/signin"
	"github.com/junkerderprovinz/parleyport/kit/status"
)

// The sign-in is the kit's, on signin.json. A password stays optional:
// until one is set, or a sign-in service is on, the interface is open and
// everyone is admin. With one, everything under /api/ needs a visitor apart
// from the routes that sign somebody in; the static files stay open, since a
// browser refused index.html would have nowhere to type a password.

// PasswordHashEnv names the environment variable a password hash can arrive
// through. It wins over the password set in the interface and cannot be
// changed or reset from there, which makes it the way back in for somebody
// who forgot that one. It is not a key in arrowloop.json, because the API
// serves that file, downloads it as a backup and replaces it wholesale, and
// restoring an old backup would switch the protection off.
const PasswordHashEnv = "ARROWLOOP_PASSWORD_HASH"

// TrustedProxiesEnv names the environment variable that lists the reverse
// proxies in front of the server, as addresses or CIDR ranges separated by
// commas. Without it every sign-in through a proxy counts against the
// proxy's address, so a stranger's wrong passwords slow the owner down as
// well.
const TrustedProxiesEnv = "ARROWLOOP_TRUSTED_PROXIES"

// passwordFromEnv is the code a change to the password gets while
// PasswordHashEnv sets it.
const passwordFromEnv = "passwordFromEnv"

// HealthPath is what the container's healthcheck asks for. It answers
// without a visitor, password or not, so the check needs no cookie.
const HealthPath = signin.APIPrefix + "options"

// needsSession decides whether one address is behind the lock. The path is
// cleaned first, so "/api/signin/v1/../../jobs" stays protected and
// "//api/jobs" is still seen as an API path without relying on the mux to
// redirect it.
func needsSession(rawPath string) bool {
	p := path.Clean("/" + rawPath)
	if p != "/api" && !strings.HasPrefix(p, "/api/") {
		return false
	}
	return !openRoutes[p] && !strings.HasPrefix(p, strings.TrimSuffix(signin.APIPrefix, "/"))
}

// openRoutes are the API paths that answer without a visitor, matched
// exactly, beside the sign-in's own contract, which decides for itself. The
// fortress status and log check a token of their own, and a call from
// another instance of the group the phrase's keys.
var openRoutes = map[string]bool{
	status.StatusPath: true,
	group.DirectPath:  true,
	status.LogPath:    true,
}

// Protect wraps a handler so the API needs a visitor once anyone can sign
// in. A request with the token from APITokenEnv gets to the routes
// tokenRoute opens without one, and one with a wrong token gets nowhere. An
// API token of the sign-in opens what its scopes allow.
func (s *Server) Protect(next http.Handler) http.Handler {
	apiToken := os.Getenv(APITokenEnv)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sent := r.Header.Get(tokenHeader); apiToken != "" && sent != "" {
			if subtle.ConstantTimeCompare([]byte(sent), []byte(apiToken)) != 1 || !tokenRoute(r.Method, r.URL.Path) {
				writeError(w, http.StatusUnauthorized, errors.New("this token does not open this address"))
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		if s.SignIn == nil || !needsSession(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		v, ok := signin.From(r.Context())
		if !ok {
			// No WWW-Authenticate header, which would open the browser's own
			// credential box.
			writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "signInFirst", "error": "this interface is password protected, sign in first"})
			return
		}
		if v.Via == signin.ViaToken && !slices.Contains(v.Scopes, "all") {
			writeJSON(w, http.StatusForbidden, map[string]string{"code": "notWithToken", "error": "this token does not open this address"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// APITokenEnv names the environment variable holding a token for other
// programs on the network, such as a file manager that plans a job here. It
// is sent in the same header as the phone app's token and opens only reading
// the job list and adding a job, so a leaked token cannot read the saved
// settings or empty the trash. A job it adds runs on its schedule like any
// other, and a mirror deletes at its destination.
const APITokenEnv = "ARROWLOOP_API_TOKEN"

// tokenRoute reports whether the API token opens a request. The path is
// cleaned as in needsSession.
func tokenRoute(method, rawPath string) bool {
	p := path.Clean("/" + rawPath)
	return p == "/api/jobs" && (method == http.MethodGet || method == http.MethodPost)
}

// statusOpens lets a dashboard read the fortress status and the log with an
// API token, password or not, since polling them must not need a session.
// While nobody can sign in, everything here is open anyway.
func (s *Server) statusOpens(r *http.Request) error {
	if s.SignIn == nil || s.SignIn.Anyone() {
		return nil
	}
	plain, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return status.ErrUnauthenticated
	}
	v, ok := s.SignIn.TokenVisitor(r.Context(), strings.TrimSpace(plain))
	if !ok || !(slices.Contains(v.Scopes, "read") || slices.Contains(v.Scopes, "all")) {
		return status.ErrUnauthenticated
	}
	return nil
}

// signInRoutes serves the sign-in's contract and the pages a browser is sent
// to. While PasswordHashEnv sets the password, nothing here changes or
// resets it, and the routes that would answer passwordFromEnv.
func (s *Server) signInRoutes(mux *http.ServeMux) {
	h := s.SignIn.Handler()
	if os.Getenv(PasswordHashEnv) != "" {
		inner := h
		h = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if setsPassword(r.Method, r.URL.Path) {
				w.Header().Set("Cache-Control", "no-store")
				writeJSON(w, http.StatusConflict, map[string]string{"error": passwordFromEnv})
				return
			}
			inner.ServeHTTP(w, r)
		})
	}
	mux.Handle(signin.APIPrefix, h)
	mux.Handle(signin.BrowserPrefix, h)
}

// setsPassword reports whether a request to the contract sets, removes or
// resets the password.
func setsPassword(method, rawPath string) bool {
	p := strings.TrimPrefix(path.Clean("/"+rawPath), signin.APIPrefix)
	switch {
	case p == "me/password":
		return method == http.MethodPut || method == http.MethodDelete
	case p == "reset-code", p == "reset":
		return method == http.MethodPost
	}
	return false
}

// signedInMoments reports whether the visitor of r signed in moments ago,
// which showing the phrase wants, since the phrase lets other instances in.
// Otherwise it answers as the sign-in does, and the interface asks for the
// password once more and tries again.
func (s *Server) signedInMoments(w http.ResponseWriter, r *http.Request) bool {
	if s.SignIn == nil {
		return true
	}
	if err := s.SignIn.Mint(r, func() error { return nil }); errors.Is(err, signin.ErrNotFresh) {
		s.SignIn.SignInAgain(w, r)
		return false
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return false
	}
	return true
}

// TrustedProxies reads TrustedProxiesEnv, and returns the entries it could
// not read apart.
func TrustedProxies() (proxies []netip.Prefix, bad []string) {
	for _, entry := range strings.Split(os.Getenv(TrustedProxiesEnv), ",") {
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

// proxyLists holds each server's TrustedProxiesEnv, read once.
var proxyLists sync.Map

// trustedProxies is TrustedProxiesEnv read apart once, for the relay this
// instance serves.
func (s *Server) trustedProxies() []netip.Prefix {
	if p, ok := proxyLists.Load(s); ok {
		return p.([]netip.Prefix)
	}
	proxies, bad := TrustedProxies()
	for _, entry := range bad {
		s.logf("%s: %q is neither an address nor a range, so it is ignored", TrustedProxiesEnv, entry)
	}
	got, _ := proxyLists.LoadOrStore(s, proxies)
	return got.([]netip.Prefix)
}

// readBody decodes a small JSON body, capped, since anybody who can reach the
// port can send one. It answers 400 itself and reports whether decoding
// worked.
func readBody(w http.ResponseWriter, r *http.Request, into any) bool {
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(into); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return false
	}
	return true
}

// keys holds the key a server without an install's key draws for itself.
var keys sync.Map

// key is the install's key, or one drawn for this server's lifetime.
func (s *Server) key() []byte {
	if s.Key != nil {
		return s.Key
	}
	if k, ok := keys.Load(s); ok {
		return k.([]byte)
	}
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		panic(fmt.Sprintf("draw a key: %v", err))
	}
	got, _ := keys.LoadOrStore(s, k)
	return got.([]byte)
}
