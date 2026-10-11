package web

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// resettable is an install with a password set in the interface whose log is
// kept for the test to read.
func resettable(t *testing.T) (*Server, *httptest.Server, *security.Store, func() string) {
	t.Helper()
	s, srv, store := newSecured(t)
	storePassword(t, store)
	var mu sync.Mutex
	var log strings.Builder
	s.Log = func(format string, args ...any) {
		mu.Lock()
		defer mu.Unlock()
		fmt.Fprintf(&log, format+"\n", args...)
	}
	return s, srv, store, func() string {
		mu.Lock()
		defer mu.Unlock()
		return log.String()
	}
}

func post(t *testing.T, c *http.Client, url string, body any) (int, string) {
	t.Helper()
	raw, _ := json.Marshal(body)
	resp, err := c.Post(url, "application/json", strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	said, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(said)
}

func liveCode(s *Server) string {
	g := s.gate()
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.reset.code
}

const resetPassword = "a brand new passphrase"

func TestTheResetCodeGoesToTheLogAndNowhereElse(t *testing.T) {
	s, srv, _, log := resettable(t)
	code, said := post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	if code != http.StatusAccepted {
		t.Fatalf("asking for a code answered %d: %s", code, said)
	}
	live := liveCode(s)
	if len(live) != resetCodeLen || strings.Trim(live, resetAlphabet) != "" {
		t.Fatalf("the code %q is not %d symbols from the alphabet", live, resetCodeLen)
	}
	if strings.Contains(said, live) || strings.Contains(said, spaced(live)) {
		t.Fatalf("the answer carries the code: %s", said)
	}
	if !strings.Contains(log(), spaced(live)) {
		t.Fatalf("the log does not show the code:\n%s", log())
	}

	// Asking again must not replace it, or a stranger could keep the owner's
	// code from ever working.
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	if liveCode(s) != live {
		t.Error("asking again replaced the code in force")
	}
}

func TestAWrongCodeDoesNotSpendTheRightOne(t *testing.T) {
	s, srv, store, _ := resettable(t)
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	live := liveCode(s)

	stranger := browser(t)
	for range 3 {
		if code, _ := post(t, stranger, srv.URL+"/api/security/reset/finish", map[string]any{"code": "AAAAAAAAAAAA", "password": resetPassword}); code != http.StatusBadRequest {
			t.Fatalf("a wrong code answered %d", code)
		}
	}
	code, said := post(t, browser(t), srv.URL+"/api/security/reset/finish", map[string]any{"code": strings.ToLower(spaced(live)), "password": resetPassword})
	if code != http.StatusOK {
		t.Fatalf("the right code, typed as copied from the log, answered %d: %s", code, said)
	}
	if !security.VerifyPassword(s.key(), resetPassword, store.Get().PasswordHash) {
		t.Error("the new password was not stored")
	}
	if liveCode(s) != "" {
		t.Error("the code still works after it was used")
	}
}

// Behind a reverse proxy every visitor shares one address, so a stranger's
// wrong codes must not keep the owner's right one out.
func TestTheRightCodeGetsThroughAThrottledAddress(t *testing.T) {
	s, srv, _, _ := resettable(t)
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	c := browser(t)
	last := 0
	for range maxFailedLogins + 2 {
		last, _ = post(t, c, srv.URL+"/api/security/reset/finish", map[string]any{"code": "AAAAAAAAAAAA", "password": resetPassword})
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("wrong codes were never throttled, the last answered %d", last)
	}
	if code, said := post(t, c, srv.URL+"/api/security/reset/finish", map[string]any{"code": liveCode(s), "password": resetPassword}); code != http.StatusOK {
		t.Fatalf("the right code from a throttled address answered %d: %s", code, said)
	}
}

func TestAWrongAndAnExpiredCodeAnswerTheSame(t *testing.T) {
	s, srv, _, _ := resettable(t)
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	wrongCode, wrongSaid := post(t, browser(t), srv.URL+"/api/security/reset/finish", map[string]any{"code": "AAAAAAAAAAAA", "password": resetPassword})

	g := s.gate()
	g.mu.Lock()
	expired := g.reset.code
	g.reset.until = time.Now().Add(-time.Second)
	g.mu.Unlock()
	oldCode, oldSaid := post(t, browser(t), srv.URL+"/api/security/reset/finish", map[string]any{"code": expired, "password": resetPassword})

	if wrongCode != oldCode || wrongSaid != oldSaid {
		t.Errorf("a wrong code answered %d %s, an expired one %d %s", wrongCode, wrongSaid, oldCode, oldSaid)
	}
}

// Any of these could belong to whoever made the reset necessary.
func TestAResetTakesTheSecondFactorThePasskeysAndTheSessions(t *testing.T) {
	s, srv, store, _ := resettable(t)
	intruder := browser(t)
	if resp, _ := attemptLogin(t, srv, intruder, uiPassword); resp.StatusCode != http.StatusOK {
		t.Fatalf("the intruder could not log in: %s", resp.Status)
	}
	if resp, _ := fetch(t, intruder, srv.URL+"/api/capabilities"); resp.StatusCode != http.StatusOK {
		t.Fatalf("the intruder has no session to lose: %s", resp.Status)
	}
	if err := store.Update(func(st *security.State) error {
		st.TOTP = security.TOTP{Secret: testTOTPSecret, Enabled: true}
		st.Passkeys = []security.Passkey{{ID: "k", CredentialID: []byte("c"), PublicKey: []byte("p"), RPID: "localhost"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	s.gate().mu.Lock()
	for i := range 2 {
		s.gate().sessions = append(s.gate().sessions, session{token: fmt.Sprint("other", i), expires: time.Now().Add(time.Hour)})
	}
	s.gate().mu.Unlock()

	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	owner := browser(t)
	code, said := post(t, owner, srv.URL+"/api/security/reset/finish", map[string]any{"code": liveCode(s), "password": resetPassword})
	if code != http.StatusOK {
		t.Fatalf("the reset answered %d: %s", code, said)
	}
	var got struct {
		Removed struct {
			SecondFactor bool `json:"secondFactor"`
			Passkeys     int  `json:"passkeys"`
			Sessions     int  `json:"sessions"`
		} `json:"removed"`
	}
	if err := json.Unmarshal([]byte(said), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Removed.SecondFactor || got.Removed.Passkeys != 1 || got.Removed.Sessions < 2 {
		t.Errorf("the answer does not say what went: %s", said)
	}
	st := store.Get()
	if st.TOTP.Enabled || st.TOTP.Secret != "" || len(st.Passkeys) != 0 {
		t.Errorf("the second factor or a passkey survived: %+v", st)
	}
	if resp, _ := fetch(t, intruder, srv.URL+"/api/capabilities"); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the intruder's session still works after the reset: %s", resp.Status)
	}
	if resp, _ := fetch(t, owner, srv.URL+"/api/capabilities"); resp.StatusCode != http.StatusOK {
		t.Errorf("the owner is not signed in after the reset: %s", resp.Status)
	}
}

// A password from the environment is changed where the container is set up;
// a code from the log must not override it.
func TestAPasswordFromTheEnvironmentIsNotResetHere(t *testing.T) {
	s, srv, _ := newSecured(t)
	t.Setenv(PasswordHashEnv, testHash(t, uiPassword))
	if code, _ := post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{}); code != http.StatusConflict {
		t.Errorf("asking for a code answered %d", code)
	}
	if liveCode(s) != "" {
		t.Error("a code was drawn for a password from the environment")
	}
}
