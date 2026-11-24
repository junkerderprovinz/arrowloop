package web_test

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/signin"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// signedInStream stands the API up behind its sign-in and returns it with a
// browser on it.
func signedInStream(t *testing.T) (*httptest.Server, *http.Client) {
	t.Helper()
	web.ShortenSignInCheck(t, 50*time.Millisecond)
	h := newHarness(t)
	s := &web.Server{History: h.history, Runner: h.runner, Key: testKey, SignIn: web.OpenSignIn(t, h.dir, testKey, "")}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return srv, sameSite()
}

func call(t *testing.T, c *http.Client, method, url, body string, header ...string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// ends reports whether the event stream of resp closes within a few seconds.
func ends(resp *http.Response) bool {
	done := make(chan struct{})
	go func() {
		defer close(done)
		r := bufio.NewReader(resp.Body)
		for {
			if _, err := r.ReadString('\n'); err != nil {
				return
			}
		}
	}()
	select {
	case <-done:
		return true
	case <-time.After(3 * time.Second):
		resp.Body.Close()
		return false
	}
}

func openStream(t *testing.T, c *http.Client, url string, header ...string) *http.Response {
	t.Helper()
	resp := call(t, c, http.MethodGet, url+"/api/events", "", header...)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the event stream answered %s", resp.Status)
	}
	return resp
}

func TestTheEventStreamEndsWithTheSessionThatOpenedIt(t *testing.T) {
	srv, c := signedInStream(t)
	call(t, c, http.MethodPut, srv.URL+signin.APIPrefix+"me/password", `{"next":"correct horse battery staple"}`).Body.Close()
	stream := openStream(t, c, srv.URL)
	call(t, c, http.MethodPost, srv.URL+signin.APIPrefix+"logout", "").Body.Close()
	if !ends(stream) {
		t.Fatal("the event stream outlived the session that opened it")
	}
}

func TestTheEventStreamOfAnOpenAppEndsOnceItCloses(t *testing.T) {
	srv, c := signedInStream(t)
	stranger := sameSite()
	stream := openStream(t, stranger, srv.URL)
	call(t, c, http.MethodPut, srv.URL+signin.APIPrefix+"me/password", `{"next":"correct horse battery staple"}`).Body.Close()
	if !ends(stream) {
		t.Fatal("a stream opened while the app was open kept going once a password closed it")
	}
}

func TestTheEventStreamEndsWithTheTokenThatOpenedIt(t *testing.T) {
	srv, c := signedInStream(t)
	call(t, c, http.MethodPut, srv.URL+signin.APIPrefix+"me/password", `{"next":"correct horse battery staple"}`).Body.Close()
	resp := call(t, c, http.MethodPost, srv.URL+signin.APIPrefix+"me/tokens", `{"name":"script","scopes":["all"]}`)
	var made struct {
		Token struct{ ID string }
		Value string
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(&made); err != nil || made.Value == "" {
		t.Fatalf("making a token answered %s: %v", resp.Status, err)
	}
	stream := openStream(t, &http.Client{}, srv.URL, "Authorization", "Bearer "+made.Value)
	call(t, c, http.MethodDelete, srv.URL+signin.APIPrefix+"me/tokens/"+made.Token.ID, "").Body.Close()
	if !ends(stream) {
		t.Fatal("the event stream outlived the token that opened it")
	}
}

func TestTheEventStreamKeepsGoingWhileItsSessionCounts(t *testing.T) {
	srv, c := signedInStream(t)
	call(t, c, http.MethodPut, srv.URL+signin.APIPrefix+"me/password", `{"next":"correct horse battery staple"}`).Body.Close()
	stream := openStream(t, c, srv.URL)
	if ends(stream) {
		t.Fatal("the event stream of a session that still counts closed")
	}
}
