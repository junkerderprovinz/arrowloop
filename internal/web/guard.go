package web

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"mime"
	"net/http"
	"os"

	"github.com/junkerderprovinz/parleyport/kit/group"
)

// Guard wraps the handler of a server that listens on a network port. A page
// on any web site can make the browser send a request to that port, so Guard
// refuses a change another site's page started or sent as anything but JSON.
// The desktop window does not need it, since nothing but its own page reaches
// it. On a phone, see AppTokenEnv.
func (s *Server) Guard(next http.Handler) http.Handler {
	crossOrigin := http.NewCrossOriginProtection()
	crossOrigin.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusForbidden, errors.New("a page from another site cannot change anything here"))
	}))
	token := os.Getenv(AppTokenEnv)
	guarded := crossOrigin.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A browser sends a form or text/plain to any site without asking, but
		// asks the server first before sending JSON there, and this server never
		// says yes.
		if changes(r.Method) && !isJSON(r.Header.Get("Content-Type")) && !groupUpload(r) {
			writeError(w, http.StatusUnsupportedMediaType, errors.New("a change has to be sent as JSON, with Content-Type: application/json"))
			return
		}
		next.ServeHTTP(w, r)
	}))

	if token == "" {
		// The fortress checks the requests of a page it opened by their
		// ticket, and that page sends them as cross-site, from an origin of
		// its own.
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if openedPath(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			guarded.ServeHTTP(w, r)
		})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if challenge := r.Header.Get(challengeHeader); challenge != "" {
			w.Header().Set(proofHeader, proof(token, challenge))
		}
		if subtle.ConstantTimeCompare([]byte(r.Header.Get(tokenHeader)), []byte(token)) != 1 {
			writeError(w, http.StatusUnauthorized, errors.New("this engine answers only the app that started it"))
			return
		}
		guarded.ServeHTTP(w, r)
	})
}

// kitUpload is the type the kit sends a backup under to the call route of
// another member. A browser asks before sending it, as it does for JSON.
const kitUpload = "application/x-kit-upload"

// groupUpload reports whether r is a stream another member of the group sends
// to the call route, which checks the call's signature itself.
func groupUpload(r *http.Request) bool {
	return r.URL.Path == group.DirectPath && r.Header.Get("Content-Type") == kitUpload
}

// changes reports whether a request method can change something.
func changes(method string) bool {
	return method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions
}

// isJSON reports whether a Content-Type header names JSON.
func isJSON(contentType string) bool {
	kind, _, err := mime.ParseMediaType(contentType)
	return err == nil && kind == "application/json"
}

// AppTokenEnv names the environment variable through which the phone app hands
// the engine it starts a secret. Loopback on a phone is open to every app on
// it, so with the variable set Guard refuses any request that does not carry
// the secret in tokenHeader.
const AppTokenEnv = "ARROWLOOP_APP_TOKEN"

const (
	tokenHeader = "X-ArrowLoop-Token"

	// Another app could bind the port before the engine does. The app asks
	// for proof that the engine knows the token rather than sending the token
	// to whoever answers.
	challengeHeader = "X-ArrowLoop-Challenge"
	proofHeader     = "X-ArrowLoop-Proof"
)

// proof is the hex HMAC-SHA256 of challenge keyed with the token.
func proof(token, challenge string) string {
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write([]byte(challenge))
	return hex.EncodeToString(mac.Sum(nil))
}
