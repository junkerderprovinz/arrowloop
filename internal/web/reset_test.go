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

// testLogs keeps what a server writes to its two logs: the timestamped lines
// through Log, and the container log the reset code goes to.
type testLogs struct {
	mu    sync.Mutex
	lines strings.Builder
	out   strings.Builder
}

func (l *testLogs) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.out.Write(p)
}

func (l *testLogs) logf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	fmt.Fprintf(&l.lines, format+"\n", args...)
}

// Lines is what went through Log.
func (l *testLogs) Lines() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.lines.String()
}

// Out is what went straight to the container log.
func (l *testLogs) Out() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.out.String()
}

// resettable is an install with a password set in the interface whose logs
// are kept for the test to read.
func resettable(t *testing.T) (*Server, *httptest.Server, *security.Store, *testLogs) {
	t.Helper()
	s, srv, store := newSecured(t)
	storePassword(t, store)
	logs := &testLogs{}
	s.Log = logs.logf
	s.CodeLog = logs
	return s, srv, store, logs
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

func expireCode(s *Server) {
	g := s.gate()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.reset.until = time.Now().Add(-time.Second)
}

const resetPassword = "a brand new passphrase"

func TestTheResetCodeGoesToTheLogAndNowhereElse(t *testing.T) {
	s, srv, _, logs := resettable(t)
	code, said := post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	if code != http.StatusAccepted {
		t.Fatalf("asking for a code answered %d: %s", code, said)
	}
	live := liveCode(s)
	if len(live) != 12 || strings.Trim(live, resetAlphabet) != "" {
		t.Fatalf("the code %q is not 12 symbols from the alphabet", live)
	}
	if strings.Contains(said, live) || strings.Contains(said, spaced(live)) {
		t.Fatalf("the answer carries the code: %s", said)
	}
	if !strings.Contains(logs.Out(), spaced(live)) {
		t.Fatalf("the container log does not show the code:\n%s", logs.Out())
	}
	if strings.Contains(logs.Lines(), live) || strings.Contains(logs.Lines(), spaced(live)) {
		t.Fatalf("the code went through the ordinary log as well:\n%s", logs.Lines())
	}
}

// Letters that look alike in a log font get typed wrong.
func TestTheCodeAlphabetLeavesOutLookalikes(t *testing.T) {
	if len(resetAlphabet) != 32 {
		t.Errorf("the alphabet has %d symbols, want 32 for five bits each", len(resetAlphabet))
	}
	if strings.ContainsAny(resetAlphabet, "0O1I") {
		t.Errorf("the alphabet %q holds 0, O, 1 or I", resetAlphabet)
	}
}

// Asking again while a code is live keeps the code somebody may be typing,
// and writes nothing, so asking in a loop cannot fill the log.
func TestAskingAgainKeepsTheCodeAndWritesNoSecond(t *testing.T) {
	s, srv, _, logs := resettable(t)
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	live := liveCode(s)
	for range 3 {
		if code, said := post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{}); code != http.StatusAccepted {
			t.Fatalf("asking again answered %d: %s", code, said)
		}
	}
	if liveCode(s) != live {
		t.Error("asking again replaced the code in force")
	}
	if n := strings.Count(logs.Out(), "PASSWORD RESET CODE"); n != 1 {
		t.Errorf("four requests wrote %d codes to the log:\n%s", n, logs.Out())
	}
}

func TestAnExpiredCodeMakesWayForAFreshOne(t *testing.T) {
	s, srv, _, logs := resettable(t)
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	first := liveCode(s)
	expireCode(s)
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	fresh := liveCode(s)
	if fresh == first {
		t.Fatal("an expired code was kept")
	}
	if !strings.Contains(logs.Out(), spaced(fresh)) {
		t.Errorf("the fresh code is not in the log:\n%s", logs.Out())
	}
}

// A code printed as an ordinary line gets lost in a busy log, and an owner
// who did not ask needs to know that nothing changed.
func TestTheCodeStandsInTheLogAsABlockOfItsOwn(t *testing.T) {
	s, srv, _, logs := resettable(t)
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	block := logs.Out()
	for _, want := range []string{
		"\n  \033[1;33m▶ PASSWORD RESET CODE: " + spaced(liveCode(s)) + "\033[0m\n",
		"Valid for 10 minutes.",
		"If nobody here asked for a reset, ignore this. The password is unchanged.\n\n",
	} {
		if !strings.Contains(block, want) {
			t.Errorf("the block lacks %q:\n%s", want, block)
		}
	}
	if len(strings.Split(spaced(liveCode(s)), "-")) != 3 {
		t.Errorf("the code is not in three groups of four: %s", spaced(liveCode(s)))
	}
}

// The form checks the length before it sends anything, and it learns the
// minimum here rather than repeating the number.
func TestAskingForACodeSaysHowLongItLastsAndTheMinimum(t *testing.T) {
	_, srv, _, _ := resettable(t)
	_, said := post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	var got struct {
		Minutes        int `json:"minutes"`
		MinPasswordLen int `json:"minPasswordLen"`
	}
	if err := json.Unmarshal([]byte(said), &got); err != nil {
		t.Fatal(err)
	}
	if got.Minutes != 10 || got.MinPasswordLen != 12 {
		t.Errorf("the answer says %d minutes and %d characters, want 10 and 12: %s", got.Minutes, got.MinPasswordLen, said)
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

// Somebody guessing at codes must not lock the owner out of signing in with
// the password, nor the other way round.
func TestWrongCodesAndWrongPasswordsCountApart(t *testing.T) {
	s, srv, _, _ := resettable(t)
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	c := browser(t)
	for range 5 {
		post(t, c, srv.URL+"/api/security/reset/finish", map[string]any{"code": "AAAAAAAAAAAA", "password": resetPassword})
	}
	if resp, said := attemptLogin(t, srv, c, uiPassword); resp.StatusCode != http.StatusOK {
		t.Fatalf("five wrong codes locked the password out: %s %s", resp.Status, said)
	}

	s.gate().clearFailures(s.lockoutKey(httptest.NewRequest(http.MethodGet, "/", nil)))
	s.gate().mu.Lock()
	s.gate().resetFailures = nil
	s.gate().mu.Unlock()
	for range 5 {
		attemptLogin(t, srv, c, "not the password")
	}
	if code, _ := post(t, c, srv.URL+"/api/security/reset/finish", map[string]any{"code": "AAAAAAAAAAAA", "password": resetPassword}); code != http.StatusBadRequest {
		t.Errorf("after five wrong passwords a wrong code answered %d, want its own 400", code)
	}
}

func TestAWrongAndAnExpiredCodeAnswerTheSame(t *testing.T) {
	s, srv, _, _ := resettable(t)
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	wrongCode, wrongSaid := post(t, browser(t), srv.URL+"/api/security/reset/finish", map[string]any{"code": "AAAAAAAAAAAA", "password": resetPassword})

	expired := liveCode(s)
	expireCode(s)
	oldCode, oldSaid := post(t, browser(t), srv.URL+"/api/security/reset/finish", map[string]any{"code": expired, "password": resetPassword})

	if wrongCode != oldCode || wrongSaid != oldSaid {
		t.Errorf("a wrong code answered %d %s, an expired one %d %s", wrongCode, wrongSaid, oldCode, oldSaid)
	}
}

// Somebody guessing shows up in the log without filling it.
func TestRefusedCodesAreSummedAtMostOnceAMinute(t *testing.T) {
	s, srv, _, logs := resettable(t)
	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	wrong := map[string]any{"code": "AAAAAAAAAAAA", "password": resetPassword}
	for range 3 {
		post(t, browser(t), srv.URL+"/api/security/reset/finish", wrong)
	}
	if n := strings.Count(logs.Lines(), "refused"); n != 1 {
		t.Fatalf("three refused codes wrote %d lines, want 1:\n%s", n, logs.Lines())
	}

	expireCode(s)
	post(t, browser(t), srv.URL+"/api/security/reset/finish", wrong)
	g := s.gate()
	g.mu.Lock()
	g.refused.reported = time.Now().Add(-time.Minute)
	g.mu.Unlock()
	post(t, browser(t), srv.URL+"/api/security/reset/finish", wrong)

	lines := strings.Split(strings.TrimSpace(logs.Lines()), "\n")
	last := lines[len(lines)-1]
	if strings.Count(logs.Lines(), "refused") != 2 || !strings.Contains(last, "2 wrong") || !strings.Contains(last, "2 entered while no code was live") {
		t.Errorf("a minute later the summary should count the four since the first line:\n%s", logs.Lines())
	}
}

// Any of these could belong to whoever made the reset necessary.
func TestAResetTakesTheSecondFactorThePasskeysAndTheSessions(t *testing.T) {
	s, srv, store, logs := resettable(t)
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
		} `json:"removed"`
	}
	if err := json.Unmarshal([]byte(said), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Removed.SecondFactor || got.Removed.Passkeys != 1 {
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
	for _, want := range []string{"1 passkey(s) removed", "two-factor authentication turned off", "every other session ended"} {
		if !strings.Contains(logs.Lines(), want) {
			t.Errorf("the log line does not say %q:\n%s", want, logs.Lines())
		}
	}
}

// A request that adds a way in holds off the reset, so what it adds exists
// before the reset removes it.
func TestAResetWaitsForAWayInBeingAdded(t *testing.T) {
	s, srv, store, _ := resettable(t)
	owner := browser(t)
	resp, _ := attemptLogin(t, srv, owner, uiPassword)
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sessionTokenOf(t, resp)})
	release, ok := s.holdSignIn(httptest.NewRecorder(), req)
	if !ok {
		t.Fatal("a live session was not let in")
	}

	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	code := liveCode(s)
	done := make(chan int, 1)
	go func() {
		status, _ := post(t, browser(t), srv.URL+"/api/security/reset/finish", map[string]any{"code": code, "password": resetPassword})
		done <- status
	}()
	// A writer waiting for the lock shuts out new readers.
	g := s.gate()
	finished := false
	for !finished && g.mint.TryRLock() {
		g.mint.RUnlock()
		select {
		case <-done:
			finished = true
		case <-time.After(time.Millisecond):
		}
	}

	if err := store.Update(func(st *security.State) error {
		st.TOTP = security.TOTP{Secret: testTOTPSecret, Enabled: true}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	release()
	if !finished {
		<-done
	}
	if store.Get().TOTP.Enabled {
		t.Error("a second factor armed while the reset waited survived it")
	}
}

// Protect let the request in before the reset ended its session; by the time
// it arms anything, that session has to be checked again.
func TestARequestLetInBeforeAResetCannotArmAnythingAfterIt(t *testing.T) {
	s, srv, store, _ := resettable(t)
	owner := browser(t)
	resp, _ := attemptLogin(t, srv, owner, uiPassword)
	token := sessionTokenOf(t, resp)

	post(t, browser(t), srv.URL+"/api/security/reset", map[string]any{})
	if code, said := post(t, browser(t), srv.URL+"/api/security/reset/finish", map[string]any{"code": liveCode(s), "password": resetPassword}); code != http.StatusOK {
		t.Fatalf("the reset answered %d: %s", code, said)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/security/totp/setup", strings.NewReader("{}"))
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	rec := httptest.NewRecorder()
	s.totpSetup(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("a session the reset ended set up a second factor: %d %s", rec.Code, rec.Body)
	}
	if store.Get().TOTP.Secret != "" {
		t.Error("a second factor secret was stored for an ended session")
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
