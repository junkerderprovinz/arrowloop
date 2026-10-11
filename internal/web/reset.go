package web

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// A forgotten password is reset with a code the server writes to its own log,
// stdout, which for a container is what `docker logs` and the Unraid log show.
// Whoever can read that log can take the install over: root on the host, but
// also a log viewer such as Dozzle, any container given the Docker socket, even
// read only, and a log collector. The code goes nowhere else, not into the
// run history, an answer or an error.
const (
	// resetCodeLen symbols from a 32-letter alphabet are 60 bits, more than a
	// throttled guesser gets through in ten minutes by many orders.
	resetCodeLen  = 12
	resetCodeLife = 10 * time.Minute

	// resetAlphabet leaves out the letters a log font makes look alike.
	resetAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

// resetCode is the one code in force, if any.
type resetCode struct {
	code  string
	until time.Time
}

// errResetCode is the one answer to a wrong and to an expired code, so a
// caller cannot tell whether a code is live.
var errResetCode = errors.New("that code is not valid or has expired")

// resetBegin writes a code to the log. A code still in force is kept rather
// than replaced, or anybody could keep the owner's code from ever working by
// asking again and again.
func (s *Server) resetBegin(w http.ResponseWriter, _ *http.Request) {
	switch s.passwordSource() {
	case passwordEnv:
		writeError(w, http.StatusConflict, errPasswordFromEnv)
		return
	case passwordNone:
		writeError(w, http.StatusConflict, errors.New("no password is set, so there is nothing to reset"))
		return
	}

	g := s.gate()
	g.mu.Lock()
	now := time.Now()
	if g.reset.code == "" || !now.Before(g.reset.until) {
		code, err := drawResetCode()
		if err != nil {
			g.mu.Unlock()
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		g.reset = resetCode{code: code, until: now.Add(resetCodeLife)}
	}
	code, until := g.reset.code, g.reset.until
	g.mu.Unlock()

	s.logf("Password reset code: %s (valid until %s). Type it on the login page under Forgot the password.",
		spaced(code), until.Format("15:04"))
	writeJSON(w, http.StatusAccepted, map[string]any{"minutes": int(resetCodeLife.Minutes())})
}

// resetFinish sets a new password with the code from the log. The right code
// always gets through, also when the address is throttled: behind a reverse
// proxy every visitor shares one address, and a stranger's wrong codes must
// not lock the owner out. Only wrong codes are throttled, and they do not
// spend the code.
//
// A reset ends every other session and takes the second factor and every
// passkey with it, since any of them could belong to whoever made the reset
// necessary. ArrowLoop has no API tokens or paired devices to revoke.
func (s *Server) resetFinish(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if !readBody(w, r, &body) {
		return
	}
	if s.passwordSource() != passwordFile {
		writeError(w, http.StatusBadRequest, errResetCode)
		return
	}

	g := s.gate()
	key := s.lockoutKey(r)
	if !g.resetCodeMatches(body.Code) {
		g.mu.Lock()
		wait, locked := g.resetLockedOut(key)
		if !locked {
			g.recordResetFailure(key)
		}
		g.mu.Unlock()
		if locked {
			w.Header().Set("Retry-After", fmt.Sprint(int(wait.Seconds())+1))
			writeError(w, http.StatusTooManyRequests, errors.New("too many wrong codes, try again in a minute"))
			return
		}
		time.Sleep(failedLoginDelay)
		writeError(w, http.StatusBadRequest, errResetCode)
		return
	}
	if utf8.RuneCountInString(body.Password) < MinPasswordLen {
		writeError(w, http.StatusBadRequest, fmt.Errorf("the password needs at least %d characters", MinPasswordLen))
		return
	}
	hash, err := HashPassword(s.key(), body.Password)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	var removed struct {
		SecondFactor bool `json:"secondFactor"`
		Passkeys     int  `json:"passkeys"`
		Sessions     int  `json:"sessions"`
	}
	err = s.Security.Update(func(st *security.State) error {
		removed.SecondFactor = st.TOTP.Enabled
		removed.Passkeys = len(st.Passkeys)
		st.PasswordHash = hash
		st.Epoch++
		st.TOTP = security.TOTP{}
		st.Passkeys = nil
		st.PasskeysUnder = fingerprint([]byte(hash))
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	g.mu.Lock()
	g.reset = resetCode{}
	removed.Sessions = len(g.sessions)
	delete(g.resetFailures, key)
	g.mu.Unlock()
	g.forgetAll()
	if err := s.startSession(w, r); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	g.clearFailures(key)
	s.logf("The password was reset with the code from the log.")
	writeJSON(w, http.StatusOK, map[string]any{"removed": removed})
}

// resetCodeMatches compares in constant time against the code in force. Spaces,
// dashes and case are what somebody copying from a log changes without
// meaning to.
func (g *authGate) resetCodeMatches(typed string) bool {
	typed = strings.ToUpper(strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(typed)))
	g.mu.Lock()
	live := g.reset
	g.mu.Unlock()
	if live.code == "" || !time.Now().Before(live.until) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(typed), []byte(live.code)) == 1
}

// resetLockedOut and recordResetFailure keep the reset's own count, apart
// from the login's, with the same limits. The caller holds g.mu.
func (g *authGate) resetLockedOut(key string) (time.Duration, bool) {
	rec, ok := g.resetFailures[key]
	if !ok || rec.count < maxFailedLogins {
		return 0, false
	}
	if wait := time.Until(rec.last.Add(lockoutWindow)); wait > 0 {
		return wait, true
	}
	delete(g.resetFailures, key)
	return 0, false
}

func (g *authGate) recordResetFailure(key string) {
	if g.resetFailures == nil {
		g.resetFailures = map[string]failureRecord{}
	}
	makeRoom(g.resetFailures)
	rec := g.resetFailures[key]
	rec.count++
	rec.last = time.Now()
	g.resetFailures[key] = rec
}

func drawResetCode() (string, error) {
	var b strings.Builder
	limit := big.NewInt(int64(len(resetAlphabet)))
	for range resetCodeLen {
		n, err := rand.Int(rand.Reader, limit)
		if err != nil {
			return "", fmt.Errorf("draw a reset code: %w", err)
		}
		b.WriteByte(resetAlphabet[n.Int64()])
	}
	return b.String(), nil
}

// spaced groups a code in fours, which is easier to copy off a log line.
func spaced(code string) string {
	var parts []string
	for len(code) > 4 {
		parts = append(parts, code[:4])
		code = code[4:]
	}
	return strings.Join(append(parts, code), "-")
}
