package web_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/junkerderprovinz/parleyport/kit/signin"
	"github.com/junkerderprovinz/parleyport/kit/signin/signintest"
)

// browserOn is a browser of its own on n: it trusts n's certificate, keeps
// its cookies and does not follow redirects.
func browserOn(n *node) *http.Client {
	c := *n.srv.Client()
	c.Jar, _ = cookiejar.New(nil)
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &c
}

// ask sends one request of c's page on n, from that page's own site.
func ask(t *testing.T, c *http.Client, n *node, method, path, body string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, n.srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	if method != http.MethodGet {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp, out
}

// throughService takes c from a browser route of n to the sign-in service and
// back, as a browser goes.
func throughService(t *testing.T, c *http.Client, n *node, p *signintest.Provider, path string) {
	t.Helper()
	resp, body := ask(t, c, n, http.MethodGet, path, "")
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("starting %s answered %d %s", path, resp.StatusCode, body)
	}
	at, err := p.Client().Get(resp.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	at.Body.Close()
	back, err := url.Parse(at.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	resp, body = ask(t, c, n, http.MethodGet, back.RequestURI(), "")
	if to := resp.Header.Get("Location"); resp.StatusCode != http.StatusFound || (strings.Contains(to, "signin=") && !strings.Contains(to, "testOk")) {
		t.Fatalf("the way back answered %d to %q %s", resp.StatusCode, to, body)
	}
}

// insideTab sends one request of the sandboxed page in a tab, which carries
// no cookie of the browser.
func insideTab(t *testing.T, n *node, path string) int {
	t.Helper()
	c := *n.srv.Client()
	c.Jar = nil
	req, _ := http.NewRequest(http.MethodGet, n.srv.URL+path, nil)
	req.Header.Set("Origin", "null")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

// newcomerTab stands up two members of a fortress, the first behind a
// sign-in service, and has someone new from that service open the second
// member from the first.
type newcomerTab struct {
	a                *node
	owner, newcomer  *http.Client
	account, service string
	inside           string
	provider         *signintest.Provider
}

var newcomerAtService = signintest.Person{Subject: "newcomer", Name: "newcomer"}

func openNewcomerTab(t *testing.T) newcomerTab {
	t.Helper()
	setOpenPassword(t)
	relayURL := testRelay(t)
	a := nodeWith(t, setup{relay: relayURL, guard: true, public: true}, newHarness(t))
	b := nodeWith(t, setup{relay: relayURL, guard: true}, newHarness(t))
	a.signIn(t)
	b.signIn(t)
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
	x := newcomerTab{a: a, owner: browserOn(a), newcomer: browserOn(a), provider: signintest.NewProvider(t)}
	x.owner.Jar = a.srv.Client().Jar
	p := x.provider

	resp, body := ask(t, x.owner, a, http.MethodPost, signin.APIPrefix+"methods/oidc",
		`{"provider":"pocket-id","issuer":"`+p.URL+`","clientId":"`+p.ClientID+`","secret":"`+p.Secret+`","ca":`+strconv.Quote(string(p.CA))+`}`)
	var added struct{ Service struct{ ID string } }
	if err := json.Unmarshal(body, &added); resp.StatusCode != http.StatusOK || err != nil {
		t.Fatalf("adding the sign-in service answered %d %s", resp.StatusCode, body)
	}
	x.service = added.Service.ID
	resp, body = ask(t, x.owner, a, http.MethodPost, signin.APIPrefix+"methods/oidc/"+x.service+"/test", `{"return":"/settings"}`)
	var test struct{ URL string }
	if err := json.Unmarshal(body, &test); resp.StatusCode != http.StatusOK || err != nil {
		t.Fatalf("the test sign-in answered %d %s", resp.StatusCode, body)
	}
	p.Next(signintest.Person{Subject: "owner", Name: "owner-at-service"})
	throughService(t, x.owner, a, p, strings.TrimPrefix(test.URL, a.srv.URL))

	p.Next(newcomerAtService)
	throughService(t, x.newcomer, a, p, "/signin/oidc/"+x.service+"?return=/")
	resp, body = ask(t, x.owner, a, http.MethodGet, signin.APIPrefix+"accounts", "")
	var list struct{ Accounts []struct{ ID, Name string } }
	if err := json.Unmarshal(body, &list); resp.StatusCode != http.StatusOK || err != nil {
		t.Fatalf("the accounts answered %d %s", resp.StatusCode, body)
	}
	for _, acc := range list.Accounts {
		if acc.Name == newcomerAtService.Name {
			x.account = acc.ID
		}
	}
	if x.account == "" {
		t.Fatalf("no account for the newcomer in %s", body)
	}

	resp, body = ask(t, x.newcomer, a, http.MethodPost, "/api/fortress/open/"+bID, "")
	var tab struct{ Path string }
	if err := json.Unmarshal(body, &tab); resp.StatusCode != http.StatusOK || err != nil {
		t.Fatalf("the newcomer opening the other member answered %d %s", resp.StatusCode, body)
	}
	x.inside = tab.Path + "/api/signin/v1/options"
	if status := insideTab(t, a, x.inside); status != http.StatusOK {
		t.Fatalf("the newcomer's tab answered %d while its sign-in counts", status)
	}
	return x
}

// The browser keeps its cookie in every case. Only its session ends, on the
// server, and the tab it opened ends with it.
func TestATabClosesOnceTheSessionThatOpenedItEnds(t *testing.T) {
	for _, tc := range []struct {
		name string
		end  func(t *testing.T, x newcomerTab)
	}{
		{"the account is blocked", func(t *testing.T, x newcomerTab) {
			if resp, body := ask(t, x.owner, x.a, http.MethodPatch, signin.APIPrefix+"accounts/"+x.account, `{"blocked":true}`); resp.StatusCode != http.StatusOK {
				t.Fatalf("blocking answered %d %s", resp.StatusCode, body)
			}
		}},
		{"the account is removed", func(t *testing.T, x newcomerTab) {
			if resp, body := ask(t, x.owner, x.a, http.MethodDelete, signin.APIPrefix+"accounts/"+x.account, ""); resp.StatusCode != http.StatusOK {
				t.Fatalf("removing answered %d %s", resp.StatusCode, body)
			}
		}},
		{"it is signed out from elsewhere", func(t *testing.T, x newcomerTab) {
			elsewhere := browserOn(x.a)
			x.provider.Next(newcomerAtService)
			throughService(t, elsewhere, x.a, x.provider, "/signin/oidc/"+x.service+"?return=/")
			if resp, body := ask(t, elsewhere, x.a, http.MethodDelete, signin.APIPrefix+"me/sessions", ""); resp.StatusCode != http.StatusOK {
				t.Fatalf("signing the other sessions out answered %d %s", resp.StatusCode, body)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			x := openNewcomerTab(t)
			tc.end(t, x)
			at, _ := url.Parse(x.a.srv.URL)
			if len(x.newcomer.Jar.Cookies(at)) == 0 {
				t.Fatal("the newcomer's browser lost its cookie, so the tab's own check went untried")
			}
			if status := insideTab(t, x.a, x.inside); status != http.StatusGone {
				t.Errorf("the tab answered %d after its session ended", status)
			}
		})
	}
}
