package web_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

const openPassword = "correct horse battery staple"

func setOpenPassword(t *testing.T) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(openPassword), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(web.PasswordHashEnv, string(hash))
}

// signIn gives n's test client a session, which every later send carries.
func (n *node) signIn(t *testing.T) {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	n.srv.Client().Jar = jar
	if status, body := n.send(t, http.MethodPost, "/api/login", `{"password":"`+openPassword+`"}`); status != http.StatusOK {
		t.Fatalf("sign in = %d %s", status, body)
	}
}

type openMember struct {
	ID     string `json:"id"`
	App    string `json:"app"`
	Online bool   `json:"online"`
	Pages  bool   `json:"pages"`
	Host   string `json:"host"`
}

func (n *node) openMembers(t *testing.T) []openMember {
	t.Helper()
	var v struct {
		Members []openMember `json:"members"`
	}
	n.get(t, "/api/fortress", &v)
	return v.Members
}

// fortressOfTwo puts two instances behind the guard into one fortress and
// returns the second one's id once the first sees that its pages open.
func fortressOfTwo(t *testing.T, signedIn bool) (*node, *node, string) {
	t.Helper()
	url := testRelay(t)
	a := nodeWith(t, setup{relay: url, guard: true}, newHarness(t))
	b := nodeWith(t, setup{relay: url, guard: true}, newHarness(t))
	if signedIn {
		a.signIn(t)
		b.signIn(t)
	}
	words := newWords(t)
	a.join(t, words)
	b.join(t, words)
	var bID string
	eventually(t, "the first to see that the second's pages open", func() bool {
		for _, m := range a.openMembers(t) {
			if m.App == "arrowloop" && m.Online && m.Pages {
				bID = m.ID
				return true
			}
		}
		return false
	})
	return a, b, bID
}

// opened sends one request of the sandboxed page as a browser does: from an
// origin of its own, without a cookie of this instance.
func opened(t *testing.T, n *node, method, path, body string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, n.srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", "null")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out
}

func TestASignedInUserOpensAnotherInstanceBehindItsOwnSignIn(t *testing.T) {
	setOpenPassword(t)
	a, b, bID := fortressOfTwo(t, true)

	status, body := a.send(t, http.MethodPost, "/api/fortress/open/"+bID, "")
	if status != http.StatusOK {
		t.Fatalf("open = %d %s", status, body)
	}
	var tab struct{ Path string }
	if err := json.Unmarshal(body, &tab); err != nil || !strings.HasPrefix(tab.Path, "/fortress/open/") {
		t.Fatalf("open answered %s", body)
	}

	resp, err := a.srv.Client().Get(a.srv.URL + tab.Path)
	if err != nil {
		t.Fatal(err)
	}
	shell, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(shell), "<iframe") || !strings.Contains(string(shell), "sandbox=") {
		t.Fatalf("the tab answered %d %s", resp.StatusCode, shell)
	}

	inside := tab.Path + "/"
	if status, body := opened(t, a, http.MethodGet, inside+"api/session", ""); status != http.StatusOK || !strings.Contains(string(body), `"authenticated":false`) {
		t.Fatalf("the opened page's session = %d %s, want a sign-in of its own", status, body)
	}
	if status, _ := opened(t, a, http.MethodGet, inside+"api/jobs", ""); status != http.StatusUnauthorized {
		t.Errorf("the jobs before signing in there = %d", status)
	}
	if status, body := opened(t, a, http.MethodPost, inside+"api/login", `{"password":"`+openPassword+`"}`); status != http.StatusOK {
		t.Fatalf("signing in on the opened page = %d %s", status, body)
	}
	if status, body := opened(t, a, http.MethodGet, inside+"api/jobs", ""); status != http.StatusOK {
		t.Errorf("the jobs after signing in there = %d %s", status, body)
	}

	for _, door := range []struct{ method, path string }{
		{http.MethodPost, "api/security/reset"},
		{http.MethodPost, "api/security/password"},
		{http.MethodPost, "api/security/read-tokens"},
		{http.MethodPost, "api/fortress/open/" + bID},
		{http.MethodDelete, "api/fortress/members/" + bID},
		{http.MethodGet, "api/fortress/v1/status"},
		{http.MethodDelete, "api/passkeys/x"},
		{http.MethodGet, "fortress/open/0123456789abcdef0123456789abcdef/"},
	} {
		status, body := opened(t, a, door.method, inside+door.path, `{}`)
		if status != http.StatusForbidden || !strings.Contains(string(body), "closed-through-fortress") {
			t.Errorf("%s %s through the fortress = %d %s", door.method, door.path, status, body)
		}
	}

	eventually(t, "the opened instance to note who opened it", func() bool {
		got, err := b.history.OpeningsAfter(context.Background(), 0, 10)
		return err == nil && len(got) == 1 && got[0].App == "ArrowLoop"
	})
	if !strings.Contains(b.log.String(), "opened this interface") {
		t.Errorf("the opened instance logged %s", b.log)
	}
	// The others read it in the fortress log.
	if status, body := a.send(t, http.MethodGet, "/api/fortress/members/"+bID+"/status", ""); status != http.StatusOK || !strings.Contains(string(body), `"code":"ui.opened"`) {
		t.Errorf("the log of the opened instance = %d %s", status, body)
	}

	// The opened page runs under this instance's address but cannot write to
	// its API, signed in or not.
	req, _ := http.NewRequest(http.MethodPost, a.srv.URL+"/api/jobs/x/stop", strings.NewReader(`{}`))
	req.Header.Set("Origin", "null")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req.Header.Set("Content-Type", "application/json")
	resp, err = a.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("a cross-site write with the session = %d", resp.StatusCode)
	}
}

func TestOnlyAPasswordSessionOpensAnotherInstance(t *testing.T) {
	setOpenPassword(t)
	a, _, bID := fortressOfTwo(t, true)
	stranger := &http.Client{}
	resp, err := stranger.Post(a.srv.URL+"/api/fortress/open/"+bID, "application/json", strings.NewReader(""))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden {
		t.Errorf("open without a session = %d", resp.StatusCode)
	}
	if status, body := a.send(t, http.MethodPost, "/api/fortress/open/nobody", ""); status != http.StatusNotFound || !strings.Contains(string(body), `"unreachable"`) {
		t.Errorf("open of a member that is not there = %d %s", status, body)
	}
}

func TestATabWithoutItsSignInLeadsBack(t *testing.T) {
	setOpenPassword(t)
	a, _, bID := fortressOfTwo(t, true)
	_, body := a.send(t, http.MethodPost, "/api/fortress/open/"+bID, "")
	var tab struct{ Path string }
	if err := json.Unmarshal(body, &tab); err != nil {
		t.Fatal(err)
	}
	noFollow := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := noFollow.Get(a.srv.URL + tab.Path)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther || resp.Header.Get("Location") != "/settings/pairing" {
		t.Errorf("the tab without the session = %d to %q", resp.StatusCode, resp.Header.Get("Location"))
	}
}

func TestTheStatusWindowGetsTheReportAndTheEndOfTheLog(t *testing.T) {
	setOpenPassword(t)
	a, _, bID := fortressOfTwo(t, true)
	status, body := a.send(t, http.MethodGet, "/api/fortress/members/"+bID+"/status?lang=de", "")
	if status != http.StatusOK {
		t.Fatalf("status = %d %s", status, body)
	}
	var out struct {
		Report struct {
			App   struct{ ID string }
			State string
		}
		Log []json.RawMessage
	}
	if err := json.Unmarshal(body, &out); err != nil || out.Report.App.ID != "arrowloop" || out.Report.State == "" || out.Log == nil {
		t.Errorf("status answered %s", body)
	}
}

// An instance that asks for no password of its own opens to nobody, since
// everybody with the phrase could use it then.
func TestAnInstanceWithoutAPasswordDoesNotOpen(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	a, _, bID := fortressOfTwo(t, false)
	status, body := a.send(t, http.MethodPost, "/api/fortress/open/"+bID, "")
	if status != http.StatusForbidden || !strings.Contains(string(body), "no_session") {
		t.Errorf("open without a password here = %d %s", status, body)
	}
}

// Everybody with the phrase could use an instance that asks for no password,
// so the fortress opens it only with one, and never the phone's engine or the
// desktop window, which nobody else reaches.
func TestTheInterfaceOpensOnlyBehindAPassword(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	h := newHarness(t)
	if offered, signIn := (&web.Server{History: h.history, Runner: h.runner, Deployment: "container"}).OpensWithSignIn(); !offered || signIn {
		t.Errorf("without a password the interface is offered %v and asks for a sign-in %v", offered, signIn)
	}
	setOpenPassword(t)
	if offered, signIn := (&web.Server{History: h.history, Runner: h.runner, Deployment: "container"}).OpensWithSignIn(); !offered || !signIn {
		t.Errorf("with a password the interface is offered %v and asks for a sign-in %v", offered, signIn)
	}
	for _, d := range []string{"phone", "desktop"} {
		if offered, _ := (&web.Server{History: h.history, Runner: h.runner, Deployment: d}).OpensWithSignIn(); offered {
			t.Errorf("the %s offers its interface", d)
		}
	}
}
