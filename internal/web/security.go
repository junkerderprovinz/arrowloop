package web

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"

	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// MinPasswordLen is the shortest password the interface stores. Five tries a
// minute is about 7200 a day, which works through a four-digit PIN in under two
// days; twelve characters put guessing out of reach whatever the limit. It
// applies when a password is set, never when one is checked, and the
// hash-password command leaves the choice to whoever runs it.
const MinPasswordLen = 12

// securityView is what the security settings draw from. It never carries a
// hash, a secret or a recovery code.
type securityView struct {
	// Available says this build keeps login settings of its own.
	Available bool `json:"available"`

	// Password says where the password in force comes from: "none", "file"
	// for one set here, or "env" for ARROWLOOP_PASSWORD_HASH, which the
	// interface cannot change.
	Password string `json:"password"`

	MinPasswordLen    int  `json:"minPasswordLen"`
	TwoFactor         bool `json:"twoFactor"`
	RecoveryCodesLeft int  `json:"recoveryCodesLeft"`
}

func (s *Server) securityView() securityView {
	v := securityView{
		Available:      s.Security != nil,
		Password:       s.passwordSource(),
		MinPasswordLen: MinPasswordLen,
	}
	if s.Security != nil {
		st := s.Security.Get()
		v.TwoFactor = st.TOTP.Enabled
		v.RecoveryCodesLeft = len(st.TOTP.Recovery)
	}
	return v
}

// securityStatus sits behind the lock like any other route, so a stranger
// learns nothing from it on an install that has a password.
func (s *Server) securityStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.securityView())
}

var errPasswordFromEnv = errors.New("the password comes from " + PasswordHashEnv + ", so it is changed where the container or service is configured")

// checkCurrentPassword guards a change to the password with the one in force,
// so a session somebody walked away from cannot be used to take the install
// over. A wrong answer counts against the address like a wrong login. It
// answers the request itself when it refuses.
func (s *Server) checkCurrentPassword(w http.ResponseWriter, r *http.Request, current string) bool {
	gate := s.gate()
	key := clientKey(r)
	if gate.refuseIfLockedOut(w, key) {
		return false
	}
	if err := bcrypt.CompareHashAndPassword(s.passwordHash(), []byte(current)); err != nil {
		gate.fail(key)
		writeError(w, http.StatusForbidden, errors.New("the current password is not right"))
		return false
	}
	return true
}

// setPassword sets the first password or replaces the one set here. The
// caller comes out signed in and every other session ends: on the first set
// there is no session yet, and every request after this one would answer 401;
// on a change, the sessions opened with a password that may have leaked are
// exactly what the change is for.
func (s *Server) setPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Current  string `json:"current"`
		Password string `json:"password"`
	}
	if !readBody(w, r, &body) {
		return
	}

	switch s.passwordSource() {
	case passwordEnv:
		writeError(w, http.StatusConflict, errPasswordFromEnv)
		return
	case passwordFile:
		if !s.checkCurrentPassword(w, r, body.Current) {
			return
		}
	}

	// Counted in characters, since a passphrase in a script that spends three
	// bytes a character is not longer for it.
	if utf8.RuneCountInString(body.Password) < MinPasswordLen {
		writeError(w, http.StatusBadRequest, fmt.Errorf("the password needs at least %d characters", MinPasswordLen))
		return
	}
	hash, err := HashPassword(body.Password)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.Security.Update(func(st *security.State) error {
		st.PasswordHash = hash
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	s.gate().forgetAll()
	if err := s.startSession(w, r); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.gate().clearFailures(clientKey(r))
	writeJSON(w, http.StatusOK, s.securityView())
}

// removePassword opens the interface to everybody who can reach it again. The
// second factor goes with the password: left armed, a password set months
// later would demand a code from an app that may be long gone.
func (s *Server) removePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Current string `json:"current"`
	}
	if !readBody(w, r, &body) {
		return
	}
	switch s.passwordSource() {
	case passwordEnv:
		writeError(w, http.StatusConflict, errPasswordFromEnv)
		return
	case passwordNone:
		writeJSON(w, http.StatusOK, s.securityView())
		return
	}
	if !s.checkCurrentPassword(w, r, body.Current) {
		return
	}
	if err := s.Security.Update(func(st *security.State) error {
		st.PasswordHash = ""
		st.TOTP = security.TOTP{}
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	// A session signed in under a password that is gone means nothing.
	s.gate().forgetAll()
	clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, s.securityView())
}

// totpSetup draws a secret and returns it with the otpauth address for the QR
// code. It is stored before it is proved, so the confirming code is checked
// against the server's copy, but the factor stays off until totpConfirm sees a
// working code, and an enrolment abandoned halfway changes nothing.
func (s *Server) totpSetup(w http.ResponseWriter, r *http.Request) {
	if len(s.passwordHash()) == 0 {
		writeError(w, http.StatusConflict, errors.New("set a password first, a second factor with no first one protects nothing"))
		return
	}
	if s.twoFactorOn() {
		writeError(w, http.StatusConflict, errors.New("two-factor authentication is already on, turn it off before setting it up again"))
		return
	}
	secret, err := security.NewTOTPSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if err := s.Security.Update(func(st *security.State) error {
		st.TOTP = security.TOTP{Secret: secret}
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"secret": secret,
		"uri":    security.TOTPURI("ArrowLoop", accountName(r), secret),
	})
}

// accountName is the label the authenticator app shows under the issuer: the
// address the interface was opened on, which tells two installs apart.
func accountName(r *http.Request) string {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if host = strings.Trim(host, "[]"); host != "" {
		return host
	}
	return "arrowloop"
}

// totpConfirm arms the second factor once the app has produced a working code
// and hands out the recovery codes. They are stored hashed, so this answer is
// the only time they exist in the clear.
func (s *Server) totpConfirm(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if !readBody(w, r, &body) {
		return
	}
	pending := s.Security.Get().TOTP
	if pending.Enabled {
		writeError(w, http.StatusConflict, errors.New("two-factor authentication is already on"))
		return
	}
	if pending.Secret == "" {
		writeError(w, http.StatusConflict, errors.New("no setup is waiting, start it again"))
		return
	}
	step, ok := security.MatchTOTP(pending.Secret, body.Code, time.Now())
	if !ok {
		writeError(w, http.StatusBadRequest, errors.New("that code is not valid, check the clock on the phone and try the next one"))
		return
	}
	plain, hashed, err := security.NewRecoveryCodes()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	err = s.Security.Update(func(st *security.State) error {
		// A second setup started in the meantime would be armed with the
		// secret this code was not made for.
		if st.TOTP.Secret != pending.Secret {
			return errors.New("the setup was started again elsewhere, scan the new code")
		}
		st.TOTP.Enabled = true
		st.TOTP.Recovery = hashed
		st.TOTP.LastStep = step
		return nil
	})
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]string{"recoveryCodes": plain})
}

// totpDisable turns the second factor off. It wants a current code or a
// recovery code, so a session somebody walked away from cannot be used to
// remove the factor quietly.
func (s *Server) totpDisable(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if !readBody(w, r, &body) {
		return
	}
	if !s.twoFactorOn() {
		writeJSON(w, http.StatusOK, s.securityView())
		return
	}
	gate := s.gate()
	key := clientKey(r)
	if gate.refuseIfLockedOut(w, key) {
		return
	}
	if !s.secondFactorOK(body.Code) {
		gate.fail(key)
		writeError(w, http.StatusForbidden, errors.New("that code is not valid"))
		return
	}
	if err := s.Security.Update(func(st *security.State) error {
		st.TOTP = security.TOTP{}
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, s.securityView())
}
