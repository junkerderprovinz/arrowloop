package web

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// A forgotten password is reset with a code the server writes to its own log,
// stdout, which for a container is what `docker logs` and the Unraid log show.
// Whoever can read that log can take the install over: root on the host, but
// also a log viewer such as Dozzle, any container given the Docker socket, even
// read only, and a log shipper that forwards container output. The code goes
// nowhere else, not into the run history, an answer or an error.
const (
	// resetCodeLen symbols from a 32-letter alphabet are 60 bits, more than a
	// throttled guesser gets through in ten minutes by many orders.
	resetCodeLen  = 12
	resetCodeLife = 10 * time.Minute

	// resetAlphabet leaves out 0, O, 1 and I, which a log font makes look
	// alike.
	resetAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

	// noResetCode stands in while no code is live, so a guess costs the same
	// comparison either way. It has the length of a code and symbols no code
	// has.
	noResetCode = "000000000000"
)

// resetCode is the one code in force, if any.
type resetCode struct {
	code  string
	until time.Time
}

// errResetCode is the one answer to a wrong and to an expired code, so a
// caller cannot tell whether a code is live.
var errResetCode = errors.New("that code is wrong or has expired")

// resetBegin writes a code to the log unless one is still live. Asking again
// then neither fills the log nor takes the code away from whoever is typing
// it, and asking after it expired writes a fresh one.
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
	fresh := ""
	if g.reset.code == "" || !time.Now().Before(g.reset.until) {
		code, err := drawResetCode()
		if err != nil {
			g.mu.Unlock()
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		g.reset = resetCode{code: code, until: time.Now().Add(resetCodeLife)}
		fresh = code
	}
	g.mu.Unlock()

	if fresh != "" {
		printResetCode(s.codeLog(), fresh)
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"minutes":        int(resetCodeLife.Minutes()),
		"minPasswordLen": MinPasswordLen,
	})
}

func (s *Server) codeLog() io.Writer {
	if s.CodeLog != nil {
		return s.CodeLog
	}
	return os.Stdout
}

// printResetCode sets the code apart from the timestamped lines in bold
// yellow, the way the ready line stands out in green.
func printResetCode(w io.Writer, code string) {
	_, _ = fmt.Fprintf(w, "\n  \033[1;33m▶ PASSWORD RESET CODE: %s\033[0m\n"+
		"    Valid for %d minutes. Enter it on the login page.\n"+
		"    If nobody here asked for a reset, ignore this. The password is unchanged.\n\n",
		spaced(code), int(resetCodeLife.Minutes()))
}

// resetFinish sets a new password with the code from the log. Wrong codes are
// throttled per address and do not spend the code. A throttled address is
// refused whatever code it sends, since a refusal that let the right code
// through would still answer each guess. Behind a reverse proxy every visitor
// shares one address, so the owner then waits for the minute to pass too.
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
	// Checked before the code, so a password that is too short does not cost
	// a guess.
	if utf8.RuneCountInString(body.Password) < MinPasswordLen {
		writeError(w, http.StatusBadRequest, fmt.Errorf("the password needs at least %d characters", MinPasswordLen))
		return
	}

	g := s.gate()
	key := s.lockoutKey(r)
	g.mu.Lock()
	wait, locked := g.resetLockedOut(key)
	g.mu.Unlock()
	if locked {
		time.Sleep(failedLoginDelay)
		w.Header().Set("Retry-After", fmt.Sprint(int(wait.Seconds())+1))
		writeError(w, http.StatusTooManyRequests, errors.New("too many wrong codes, try again in a minute"))
		return
	}
	if ok, stale := g.checkResetCode(body.Code); !ok {
		g.mu.Lock()
		g.refused.add(stale, s.logf)
		g.recordResetFailure(key)
		g.mu.Unlock()
		time.Sleep(failedLoginDelay)
		writeError(w, http.StatusBadRequest, errResetCode)
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
	}
	// The keys and the password go in one write, so a failure never leaves
	// old keys beside a new password.
	g.mint.Lock()
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
	if err == nil {
		g.mu.Lock()
		g.reset = resetCode{}
		g.sessions = nil
		delete(g.resetFailures, key)
		g.mu.Unlock()
	}
	g.mint.Unlock()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	if err := s.startSession(w, r); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	g.clearFailures(key)
	gone := []string{fmt.Sprintf("%d passkey(s) removed", removed.Passkeys), "every other session ended"}
	if removed.SecondFactor {
		gone = append([]string{"two-factor authentication turned off"}, gone...)
	}
	s.logf("the password was reset with the code from the log: %s", strings.Join(gone, ", "))
	writeJSON(w, http.StatusOK, map[string]any{"removed": removed})
}

// holdSignIn holds off a reset or a password change until release is called,
// for a request that adds a way in or arms the second factor. Protect let the
// request in before taking the hold, so the session is checked again under
// it: a reset in between has ended it.
func (s *Server) holdSignIn(w http.ResponseWriter, r *http.Request) (release func(), ok bool) {
	g := s.gate()
	g.mint.RLock()
	if len(s.passwordHash()) > 0 && !g.accepts(cookieToken(r)) {
		g.mint.RUnlock()
		writeError(w, http.StatusUnauthorized, errors.New("this session has ended, log in again"))
		return nil, false
	}
	return g.mint.RUnlock, true
}

// checkResetCode reports whether typed is the code in force, comparing in
// constant time against a stand-in when none is live. stale says no code was
// live to guess at, which only the log is told. Spaces, dashes and case are
// what somebody copying from a log changes without meaning to.
func (g *authGate) checkResetCode(typed string) (ok, stale bool) {
	typed = strings.ToUpper(strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(typed)))
	g.mu.Lock()
	live := g.reset
	g.mu.Unlock()
	stale = live.code == "" || !time.Now().Before(live.until)
	want := live.code
	if stale {
		want = noResetCode
	}
	return subtle.ConstantTimeCompare([]byte(typed), []byte(want)) == 1 && !stale, stale
}

// resetRefusals counts refused codes for a log line written at most once a
// minute, so somebody guessing shows in the log without filling it.
type resetRefusals struct {
	wrong, stale int
	reported     time.Time
}

// add counts one refusal. The caller holds g.mu.
func (c *resetRefusals) add(stale bool, logf func(string, ...any)) {
	if stale {
		c.stale++
	} else {
		c.wrong++
	}
	if time.Since(c.reported) < time.Minute {
		return
	}
	logf("refused %d wrong password reset code(s) and %d entered while no code was live since the last report", c.wrong, c.stale)
	*c = resetRefusals{reported: time.Now()}
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
