package web

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// The password the interface sets in these tests; long enough for the minimum.
const uiPassword = "a long enough passphrase"

// newSecured stands up the whole handler with a security store in a fresh
// configuration folder, the way `arrowloop web` runs.
func newSecured(t *testing.T) (*Server, *httptest.Server, *security.Store) {
	t.Helper()
	t.Setenv(PasswordHashEnv, "")
	store, err := security.Open(filepath.Join(t.TempDir(), "arrowloop.json"))
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{
		UI:       fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>the arrowloop interface</html>")}},
		Security: store,
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return s, srv, store
}

func postAs(t *testing.T, c *http.Client, url string, body any) (*http.Response, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	resp, err := c.Post(url, "application/json", strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	said, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(said, &out)
	return resp, out
}

// storeTOTP arms the second factor the way a finished enrolment leaves it.
func storeTOTP(t *testing.T, store *security.Store, recovery []string) {
	t.Helper()
	err := store.Update(func(st *security.State) error {
		st.TOTP = security.TOTP{Secret: testTOTPSecret, Enabled: true, Recovery: recovery}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// storePassword sets a password the way the interface would have.
func storePassword(t *testing.T, store *security.Store) {
	t.Helper()
	hash := testHash(t, uiPassword)
	if err := store.Update(func(st *security.State) error { st.PasswordHash = hash; return nil }); err != nil {
		t.Fatal(err)
	}
}

const testTOTPSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" // RFC 6238 test vector gitleaks:allow

func codeAt(t *testing.T, at time.Time) string {
	t.Helper()
	c, err := security.TOTPCode(testTOTPSecret, at)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// The first password is set from an open interface, so the request that turns
// the lock on is the last one this browser could make without a session. It
// has to come back signed in, or every control answers 401 until a reload.
func TestSettingTheFirstPasswordSignsTheCallerIn(t *testing.T) {
	_, srv, store := newSecured(t)
	c := browser(t)

	resp, said := postAs(t, c, srv.URL+"/api/security/password", map[string]string{"password": uiPassword})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("setting the first password answered %s: %v", resp.Status, said)
	}
	if said["password"] != passwordFile {
		t.Errorf("the answer says the password comes from %v, want %q", said["password"], passwordFile)
	}
	if bcrypt.CompareHashAndPassword([]byte(store.Get().PasswordHash), []byte(uiPassword)) != nil {
		t.Fatal("the stored hash does not verify the password that was set")
	}

	if open, _ := fetch(t, c, srv.URL+"/api/capabilities"); open.StatusCode != http.StatusOK {
		t.Errorf("the browser that set the password is locked out, answering %s", open.Status)
	}
	if shut, _ := fetch(t, browser(t), srv.URL+"/api/capabilities"); shut.StatusCode != http.StatusUnauthorized {
		t.Errorf("another browser got in without the password, answering %s", shut.Status)
	}
}

func TestAShortPasswordIsRefused(t *testing.T) {
	_, srv, store := newSecured(t)
	// Eleven characters of three bytes each: long in bytes, short in characters.
	for _, pw := range []string{"1234", strings.Repeat("ä", MinPasswordLen-1)} {
		resp, _ := postAs(t, browser(t), srv.URL+"/api/security/password", map[string]string{"password": pw})
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%d characters answered %s", len([]rune(pw)), resp.Status)
		}
	}
	if store.Get().PasswordHash != "" {
		t.Fatal("a refused password was stored")
	}
}

// A hash in any answer would be handed to whoever can read the page.
func TestNoAnswerCarriesTheHash(t *testing.T) {
	_, srv, store := newSecured(t)
	c := browser(t)
	postAs(t, c, srv.URL+"/api/security/password", map[string]string{"password": uiPassword})
	hash := store.Get().PasswordHash

	for _, path := range []string{"/api/security", "/api/session", "/api/passkeys"} {
		_, body := fetch(t, c, srv.URL+path)
		if strings.Contains(body, hash) || strings.Contains(body, "$2a$") {
			t.Errorf("%s carries the password hash: %s", path, body)
		}
	}
}

func TestChangingThePasswordNeedsTheCurrentOne(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	c := browser(t)
	if resp, said := attemptLogin(t, srv, c, uiPassword); resp.StatusCode != http.StatusOK {
		t.Fatalf("logging in: %s %s", resp.Status, said)
	}

	next := uiPassword + " and more"
	resp, _ := postAs(t, c, srv.URL+"/api/security/password", map[string]string{"current": "not it", "password": next})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("a wrong current password answered %s", resp.Status)
	}
	if bcrypt.CompareHashAndPassword([]byte(store.Get().PasswordHash), []byte(uiPassword)) != nil {
		t.Fatal("the password changed although the current one was wrong")
	}

	resp, said := postAs(t, c, srv.URL+"/api/security/password", map[string]string{"current": uiPassword, "password": next})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the change answered %s: %v", resp.Status, said)
	}
	if bcrypt.CompareHashAndPassword([]byte(store.Get().PasswordHash), []byte(next)) != nil {
		t.Fatal("the new password is not the one stored")
	}
}

// Somebody changing a password because it may have leaked expects the
// sessions opened with it to end, while his own carries on.
func TestChangingThePasswordEndsEveryOtherSession(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)

	other, _ := attemptLogin(t, srv, browser(t), uiPassword)
	otherToken := sessionTokenOf(t, other)
	if code := replay(t, srv, otherToken); code != http.StatusOK {
		t.Fatalf("the other session did not work to begin with, answering %d", code)
	}

	c := browser(t)
	attemptLogin(t, srv, c, uiPassword)
	resp, said := postAs(t, c, srv.URL+"/api/security/password", map[string]string{"current": uiPassword, "password": uiPassword + "!"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the change answered %s: %v", resp.Status, said)
	}

	if code := replay(t, srv, otherToken); code != http.StatusUnauthorized {
		t.Errorf("a session from before the change still works, answering %d", code)
	}
	if open, _ := fetch(t, c, srv.URL+"/api/capabilities"); open.StatusCode != http.StatusOK {
		t.Errorf("the session that made the change was ended too, answering %s", open.Status)
	}
}

// The current-password check is a second place to guess the password, so it
// shares the login's limit.
func TestWrongCurrentPasswordsCountTowardsTheLockout(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	c := browser(t)
	attemptLogin(t, srv, c, uiPassword)

	for range maxFailedLogins {
		postAs(t, c, srv.URL+"/api/security/password", map[string]string{"current": "guess", "password": uiPassword + "?"})
	}
	resp, _ := postAs(t, c, srv.URL+"/api/security/password", map[string]string{"current": uiPassword, "password": uiPassword + "?"})
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("the check still looked at a password after %d wrong ones, answering %s", maxFailedLogins, resp.Status)
	}
}

// A second factor left behind would demand a code from a long-gone app once a
// password is set again, and a session signed in under a removed password
// means nothing.
func TestRemovingThePasswordTakesTheSecondFactorAndTheSessionsWithIt(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	storeTOTP(t, store, []string{"x"})
	c := browser(t)
	if resp, said := postAs(t, c, srv.URL+"/api/login", loginRequest{Password: uiPassword, Code: codeAt(t, time.Now())}); resp.StatusCode != http.StatusOK {
		t.Fatalf("logging in: %s %v", resp.Status, said)
	}

	if resp, _ := postAs(t, c, srv.URL+"/api/security/password/remove", map[string]string{"current": "wrong"}); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("removing with a wrong password answered %s", resp.Status)
	}
	resp, said := postAs(t, c, srv.URL+"/api/security/password/remove", map[string]string{"current": uiPassword})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("removing answered %s: %v", resp.Status, said)
	}
	st := store.Get()
	if st.PasswordHash != "" || st.TOTP.Enabled || st.TOTP.Secret != "" || len(st.TOTP.Recovery) != 0 {
		t.Errorf("something was left behind: %+v", st)
	}
	cleared := false
	for _, cookie := range resp.Cookies() {
		if cookie.Name == sessionCookieName && cookie.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Error("the session cookie was left in the browser")
	}
}

// The variable is the way back in for somebody who forgot the password set in
// the interface, so it has to win, and the interface must not pretend it can
// change it.
func TestTheEnvironmentWinsOverThePasswordSetHere(t *testing.T) {
	_, _, store := newSecured(t)
	storePassword(t, store)

	envPassword := "the one from the environment"
	t.Setenv(PasswordHashEnv, testHash(t, envPassword))
	s := &Server{Security: store}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)

	if resp, _ := attemptLogin(t, srv, browser(t), uiPassword); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the password set in the interface still works beside the variable, answering %s", resp.Status)
	}
	c := browser(t)
	if resp, said := attemptLogin(t, srv, c, envPassword); resp.StatusCode != http.StatusOK {
		t.Fatalf("the password from the variable was refused: %s %s", resp.Status, said)
	}

	var view securityView
	_, body := fetch(t, c, srv.URL+"/api/security")
	if err := json.Unmarshal([]byte(body), &view); err != nil {
		t.Fatal(err)
	}
	if view.Password != passwordEnv {
		t.Errorf("the interface is told the password comes from %q", view.Password)
	}
	for _, path := range []string{"/api/security/password", "/api/security/password/remove"} {
		resp, _ := postAs(t, c, srv.URL+path, map[string]string{"current": envPassword, "password": "something else entirely"})
		if resp.StatusCode != http.StatusConflict {
			t.Errorf("%s answered %s for a password that lives in the environment", path, resp.Status)
		}
	}
}

func TestThePasswordAloneAsksForTheCode(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	storeTOTP(t, store, nil)

	resp, said := postAs(t, browser(t), srv.URL+"/api/login", loginRequest{Password: uiPassword})
	if resp.StatusCode != http.StatusOK || said["needCode"] != true || said["authenticated"] == true {
		t.Fatalf("the password alone answered %s %v, want a request for the code", resp.Status, said)
	}
	for _, cookie := range resp.Cookies() {
		if cookie.Name == sessionCookieName {
			t.Fatal("a session was handed out before the second factor")
		}
	}
}

func TestPasswordAndCodeSignIn(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	storeTOTP(t, store, nil)

	c := browser(t)
	resp, said := postAs(t, c, srv.URL+"/api/login", loginRequest{Password: uiPassword, Code: codeAt(t, time.Now())})
	if resp.StatusCode != http.StatusOK || said["authenticated"] != true {
		t.Fatalf("password and code answered %s %v", resp.Status, said)
	}
	if open, _ := fetch(t, c, srv.URL+"/api/capabilities"); open.StatusCode != http.StatusOK {
		t.Errorf("the session does not open the API, answering %s", open.Status)
	}

	wrong, said := postAs(t, browser(t), srv.URL+"/api/login", loginRequest{Password: uiPassword, Code: "000000"})
	if wrong.StatusCode != http.StatusUnauthorized || said["needCode"] != true {
		t.Errorf("a wrong code answered %s %v", wrong.Status, said)
	}
}

// A code read over somebody's shoulder is still valid for the rest of its
// window unless the server remembers it was used.
func TestACodeWorksOnce(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	storeTOTP(t, store, nil)
	code := codeAt(t, time.Now())

	if resp, said := postAs(t, browser(t), srv.URL+"/api/login", loginRequest{Password: uiPassword, Code: code}); resp.StatusCode != http.StatusOK {
		t.Fatalf("the first use answered %s %v", resp.Status, said)
	}
	if resp, _ := postAs(t, browser(t), srv.URL+"/api/login", loginRequest{Password: uiPassword, Code: code}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the same code signed in a second time, answering %s", resp.Status)
	}
}

// Asking without a code is how the interface learns it needs one.
func TestAskingWithoutACodeIsNotAFailure(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	storeTOTP(t, store, nil)
	c := browser(t)

	for range maxFailedLogins + 3 {
		postAs(t, c, srv.URL+"/api/login", loginRequest{Password: uiPassword})
	}
	resp, said := postAs(t, c, srv.URL+"/api/login", loginRequest{Password: uiPassword, Code: codeAt(t, time.Now())})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the real code was refused after asking without one: %s %v", resp.Status, said)
	}
}

// A million codes fall in under a day at full speed unless wrong ones are
// limited, and the right password must not reset the count.
func TestWrongCodesCountTowardsTheLockout(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	storeTOTP(t, store, nil)
	c := browser(t)

	for range maxFailedLogins {
		postAs(t, c, srv.URL+"/api/login", loginRequest{Password: uiPassword, Code: "000000"})
	}
	resp, _ := postAs(t, c, srv.URL+"/api/login", loginRequest{Password: uiPassword, Code: codeAt(t, time.Now())})
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("wrong codes did not lock the address out, answering %s", resp.Status)
	}
}

// A recovery code that survives its own use is a permanent second password.
func TestARecoveryCodeIsSpentWhenUsed(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	plain, hashed, err := security.NewRecoveryCodes()
	if err != nil {
		t.Fatal(err)
	}
	storeTOTP(t, store, hashed)

	if resp, said := postAs(t, browser(t), srv.URL+"/api/login", loginRequest{Password: uiPassword, Code: plain[0]}); resp.StatusCode != http.StatusOK {
		t.Fatalf("a recovery code was refused: %s %v", resp.Status, said)
	}
	if left := len(store.Get().TOTP.Recovery); left != len(plain)-1 {
		t.Errorf("%d codes left, want %d", left, len(plain)-1)
	}
	if resp, _ := postAs(t, browser(t), srv.URL+"/api/login", loginRequest{Password: uiPassword, Code: plain[0]}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a spent recovery code worked twice, answering %s", resp.Status)
	}
}

func TestAnUnfinishedSetupDoesNotAskForACode(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	if err := store.Update(func(st *security.State) error { st.TOTP.Secret = testTOTPSecret; return nil }); err != nil {
		t.Fatal(err)
	}
	resp, said := postAs(t, browser(t), srv.URL+"/api/login", loginRequest{Password: uiPassword})
	if resp.StatusCode != http.StatusOK || said["authenticated"] != true {
		t.Fatalf("an abandoned setup locked the owner out: %s %v", resp.Status, said)
	}
}

func TestSettingUpTheSecondFactorRoundTrip(t *testing.T) {
	_, srv, store := newSecured(t)
	c := browser(t)
	postAs(t, c, srv.URL+"/api/security/password", map[string]string{"password": uiPassword})

	resp, said := postAs(t, c, srv.URL+"/api/security/totp/setup", map[string]string{})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("setup answered %s %v", resp.Status, said)
	}
	secret, _ := said["secret"].(string)
	uri, _ := said["uri"].(string)
	if secret == "" || !strings.HasPrefix(uri, "otpauth://totp/") {
		t.Fatalf("setup returned no usable secret: %v", said)
	}
	if store.Get().TOTP.Enabled {
		t.Fatal("setup alone switched the second factor on")
	}

	if resp, _ := postAs(t, c, srv.URL+"/api/security/totp/confirm", map[string]string{"code": "000000"}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a wrong confirming code answered %s", resp.Status)
	}
	code, err := security.TOTPCode(secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	resp, said = postAs(t, c, srv.URL+"/api/security/totp/confirm", map[string]string{"code": code})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("confirming answered %s %v", resp.Status, said)
	}
	codes, _ := said["recoveryCodes"].([]any)
	if len(codes) == 0 {
		t.Fatalf("confirming handed out no recovery codes: %v", said)
	}
	if !store.Get().TOTP.Enabled {
		t.Fatal("confirming did not switch the second factor on")
	}
	for _, rc := range codes {
		if strings.Contains(strings.Join(store.Get().TOTP.Recovery, " "), rc.(string)) {
			t.Fatal("a recovery code is stored in the clear")
		}
	}

	// Turning it off needs a code, so a session left open cannot remove it.
	if resp, _ := postAs(t, c, srv.URL+"/api/security/totp/disable", map[string]string{"code": "000000"}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("a wrong code turned the factor off, answering %s", resp.Status)
	}
	resp, said = postAs(t, c, srv.URL+"/api/security/totp/disable", map[string]string{"code": codes[0].(string)})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("turning it off with a recovery code answered %s %v", resp.Status, said)
	}
	if st := store.Get().TOTP; st.Enabled || st.Secret != "" {
		t.Errorf("the second factor is still there: %+v", st)
	}
}

func TestTheSecondFactorNeedsAPassword(t *testing.T) {
	_, srv, _ := newSecured(t)
	if resp, _ := postAs(t, browser(t), srv.URL+"/api/security/totp/setup", map[string]string{}); resp.StatusCode != http.StatusConflict {
		t.Errorf("setup without a password answered %s", resp.Status)
	}
}

// The count of recovery codes left is the owner's business.
func TestAStrangerLearnsNothingAboutTheSecondFactor(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	storeTOTP(t, store, []string{"a", "b"})

	if resp, _ := fetch(t, browser(t), srv.URL+"/api/security"); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the security settings answered a stranger with %s", resp.Status)
	}
	_, body := fetch(t, browser(t), srv.URL+"/api/session")
	if strings.Contains(body, "recovery") || strings.Contains(body, "twoFactor") {
		t.Errorf("the open probe says more than whether to draw a login: %s", body)
	}
}

// A separate file is what keeps the hash out of the backup, and the password
// itself belongs nowhere on disk.
func TestThePasswordLandsInItsOwnFile(t *testing.T) {
	_, srv, store := newSecured(t)
	postAs(t, browser(t), srv.URL+"/api/security/password", map[string]string{"password": uiPassword})
	body, err := os.ReadFile(store.Path())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), store.Get().PasswordHash) {
		t.Error("the hash is not in security.json")
	}
	if strings.Contains(string(body), uiPassword) {
		t.Error("security.json holds the password itself")
	}
}
