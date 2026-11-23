package security

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/signin"
)

// install is an ArrowLoop folder as the version before the sign-in package
// left it.
type install struct {
	t      *testing.T
	config string
	log    bytes.Buffer
	codes  bytes.Buffer
}

func newInstall(t *testing.T) *install {
	t.Helper()
	return &install{t: t, config: filepath.Join(t.TempDir(), "arrowloop.json")}
}

// left writes security.json as the version before wrote it.
func (in *install) left(st State) {
	in.t.Helper()
	s, err := Open(in.config, testKey)
	if err != nil {
		in.t.Fatal(err)
	}
	if err := s.Update(func(have *State) error { *have = st; return nil }); err != nil {
		in.t.Fatal(err)
	}
}

func (in *install) hash(pw string) string {
	in.t.Helper()
	h, err := HashPassword(testKey, pw)
	if err != nil {
		in.t.Fatal(err)
	}
	return h
}

// start opens the sign-in as a start of the new version does.
func (in *install) start(envHash, public string) *signin.Auth {
	in.t.Helper()
	auth, err := OpenSignIn(SignIn{
		ConfigPath: in.config, Key: testKey, PasswordHash: envHash, Public: public,
		Logf:    func(format string, args ...any) { fmt.Fprintf(&in.log, format+"\n", args...) },
		CodeLog: &in.codes,
	})
	if err != nil {
		in.t.Fatalf("OpenSignIn: %v", err)
	}
	in.t.Cleanup(func() { _ = auth.Close() })
	return auth
}

// browser talks to the sign-in as a page on the same site does.
type browser struct {
	t   *testing.T
	srv *httptest.Server
	c   *http.Client
}

func visit(t *testing.T, auth *signin.Auth) *browser {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle(signin.APIPrefix, auth.Handler())
	mux.HandleFunc("/api/jobs", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := signin.From(r.Context()); !ok {
			w.WriteHeader(http.StatusUnauthorized)
		}
	})
	srv := httptest.NewServer(auth.Guard(mux))
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	return &browser{t: t, srv: srv, c: &http.Client{Jar: jar}}
}

// to is the same browser after a restart, with its cookies.
func (b *browser) to(auth *signin.Auth) *browser {
	next := visit(b.t, auth)
	next.c.Jar = b.c.Jar
	return next
}

func (b *browser) call(method, path string, body any) (int, map[string]any) {
	b.t.Helper()
	var r *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		r = bytes.NewReader(raw)
	} else {
		r = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, b.srv.URL+path, r)
	if err != nil {
		b.t.Fatal(err)
	}
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := b.c.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer res.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func (b *browser) signIn(pw string) map[string]any {
	b.t.Helper()
	code, out := b.call("POST", signin.APIPrefix+"login", map[string]string{"password": pw})
	if code != http.StatusOK {
		b.t.Fatalf("signing in with %q answered %d %v", pw, code, out)
	}
	return out
}

func (b *browser) refused(pw string) {
	b.t.Helper()
	if code, out := b.call("POST", signin.APIPrefix+"login", map[string]string{"password": pw}); code != http.StatusUnauthorized {
		b.t.Fatalf("signing in with %q answered %d %v, not a refusal", pw, code, out)
	}
}

func (b *browser) in() bool {
	b.t.Helper()
	code, _ := b.call("GET", "/api/jobs", nil)
	return code == http.StatusOK
}

func TestAnUpgradeKeepsThePasswordTheSecondFactorAndTheRecoveryCodes(t *testing.T) {
	in := newInstall(t)
	in.left(State{
		PasswordHash: in.hash("old password"),
		TOTP: TOTP{Secret: rfcSecret, Enabled: true, LastStep: 7,
			Recovery: []string{HashRecoveryCode("abcde-fghjk"), HashRecoveryCode("mnpqr-stuvw")}},
	})
	auth := in.start("", "")
	if auth.Anyone() {
		t.Fatal("the upgrade left the install open")
	}

	b := visit(t, auth)
	b.refused("another password")
	if out := b.signIn("old password"); out["step"] != "code" {
		t.Fatalf("the password alone signed in past the second factor: %v", out)
	}
	code, err := TOTPCode(rfcSecret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if status, out := b.call("POST", signin.APIPrefix+"login/totp", map[string]string{"code": code}); status != http.StatusOK {
		t.Fatalf("the authenticator's code answered %d %v", status, out)
	}
	if !b.in() {
		t.Fatal("signed in, yet the API stays shut")
	}

	again := visit(t, auth)
	again.signIn("old password")
	if status, out := again.call("POST", signin.APIPrefix+"login/totp", map[string]string{"code": "ABCDE FGHJK"}); status != http.StatusOK {
		t.Fatalf("a recovery code of the version before answered %d %v", status, out)
	}
	third := visit(t, auth)
	third.signIn("old password")
	if status, _ := third.call("POST", signin.APIPrefix+"login/totp", map[string]string{"code": "abcde-fghjk"}); status != http.StatusUnauthorized {
		t.Fatal("a recovery code counted twice")
	}
}

func TestAnUpgradeKeepsTheReadTokensOfDashboards(t *testing.T) {
	in := newInstall(t)
	plain := readTokenPrefix + "a-token-of-the-version-before"
	in.left(State{
		PasswordHash: in.hash("old password"),
		ReadTokens:   []ReadToken{{ID: "1", Name: "Homepage", Hash: ReadTokenDigest(testKey, plain), CreatedAt: 1700000000}},
	})
	auth := in.start("", "")
	v, ok := auth.TokenVisitor(context.Background(), plain)
	if !ok || v.Via != signin.ViaToken || len(v.Scopes) != 1 || v.Scopes[0] != "read" {
		t.Fatalf("the dashboard's token came back as %+v, %v", v, ok)
	}
	if _, ok := auth.TokenVisitor(context.Background(), plain+"x"); ok {
		t.Fatal("a token one character off was taken")
	}
}

func TestAnUpgradeKeepsThePasskeysOfThePasswordInForceOnly(t *testing.T) {
	for _, tc := range []struct {
		name  string
		under func(hash string) string
		kept  int
	}{
		{"registered under it", Fingerprint, 1},
		{"from a file that kept no fingerprint", func(string) string { return "" }, 1},
		{"registered under an earlier password", func(string) string { return Fingerprint("earlier") }, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := newInstall(t)
			hash := in.hash("old password")
			in.left(State{
				PasswordHash: hash, PasskeyUser: bytes.Repeat([]byte{9}, 32), PasskeysUnder: tc.under(hash),
				Passkeys: []Passkey{{ID: "p", Name: "Phone", CredentialID: []byte{1, 2, 3}, PublicKey: []byte{4}, RPID: "al.example.com", BackedUp: true, CreatedAt: 1700000000}},
			})
			b := visit(t, in.start("", ""))
			b.signIn("old password")
			status, out := b.call("GET", signin.APIPrefix+"me/passkeys", nil)
			keys, _ := out["passkeys"].([]any)
			if status != http.StatusOK || len(keys) != tc.kept {
				t.Fatalf("the passkeys came back as %d %v, want %d of them", status, out, tc.kept)
			}
		})
	}
}

func TestTheHashFromTheEnvironmentWinsOverThePasswordSetInTheInterface(t *testing.T) {
	in := newInstall(t)
	in.left(State{PasswordHash: in.hash("set in the interface")})
	auth := in.start("", "")
	visit(t, auth).signIn("set in the interface")
	_ = auth.Close()

	// The sign-in wrote the password anew in the package's form, and a hash
	// set afterwards still wins, start after start.
	env := in.hash("from the environment")
	for range 2 {
		auth = in.start(env, "")
		b := visit(t, auth)
		b.refused("set in the interface")
		b.signIn("from the environment")
		_ = auth.Close()
	}
}

func TestAHashFromTheEnvironmentClosesAnInstallThatWasOpen(t *testing.T) {
	in := newInstall(t)
	open := in.start("", "")
	if !open.Anyone() {
		t.Fatal("an install without a password started closed")
	}
	_ = open.Close()
	auth := in.start(in.hash("from the environment"), "")
	if auth.Anyone() {
		t.Fatal("the hash from the environment left the install open")
	}
	b := visit(t, auth)
	if b.in() {
		t.Fatal("the API answered before anyone signed in")
	}
	b.signIn("from the environment")
	if !b.in() {
		t.Fatal("signed in, yet the API stays shut")
	}
}

func TestANewHashFromTheEnvironmentEndsEverySession(t *testing.T) {
	in := newInstall(t)
	first := in.hash("first")
	auth := in.start(first, "")
	b := visit(t, auth)
	b.signIn("first")
	_ = auth.Close()

	auth = in.start(first, "")
	if !b.to(auth).in() {
		t.Fatal("a restart with the same hash signed the browser out")
	}
	_ = auth.Close()

	b = b.to(in.start(in.hash("second"), ""))
	if b.in() {
		t.Fatal("the session of the old hash outlived the new one")
	}
	b.refused("first")
	b.signIn("second")
}

func TestTheVersionBeforeFindsNoPasswordToTakeOnceItChanged(t *testing.T) {
	in := newInstall(t)
	in.left(State{PasswordHash: in.hash("old password"), TOTP: TOTP{}, ReadTokens: []ReadToken{{ID: "1", Name: "Homepage", Hash: "x"}}})
	b := visit(t, in.start("", ""))
	b.signIn("old password")
	if status, out := b.call("PUT", signin.APIPrefix+"me/password", map[string]string{"current": "old password", "next": "new password"}); status != http.StatusOK {
		t.Fatalf("changing the password answered %d %v", status, out)
	}

	deadline := time.Now().Add(5 * time.Second)
	for {
		old, err := Open(in.config, testKey)
		if err != nil {
			t.Fatal(err)
		}
		st := old.Get()
		if st.PasswordHash == droppedHash {
			if VerifyPassword(testKey, "old password", st.PasswordHash) || VerifyPassword(testKey, "new password", st.PasswordHash) || len(st.ReadTokens) != 0 {
				t.Fatalf("security.json still lets the version before in: %+v", st)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("security.json kept its password after the change: %+v", st)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if body, err := os.ReadFile(filepath.Join(filepath.Dir(in.config), FileName)); err != nil || !strings.Contains(string(body), `"version": 1`) {
		t.Fatalf("the version before can no longer read security.json: %s %v", body, err)
	}
}

func TestThePublicAddressComesFromTheEnvironmentOrThePasskeysBefore(t *testing.T) {
	in := newInstall(t)
	hash := in.hash("old password")
	in.left(State{
		PasswordHash: hash, PasskeyUser: bytes.Repeat([]byte{9}, 32), PasskeysUnder: Fingerprint(hash),
		Passkeys: []Passkey{{ID: "p", Name: "Phone", CredentialID: []byte{1}, PublicKey: []byte{4}, RPID: "al.example.com"}},
	})
	o := SignIn{ConfigPath: in.config, Key: testKey}
	old, err := Open(in.config, testKey)
	if err != nil {
		t.Fatal(err)
	}
	store := memStore{}
	got, err := o.publicURL(context.Background(), store, old.Get())
	if err != nil || got == nil || got.String() != "https://al.example.com" {
		t.Fatalf("the passkeys' address came back as %v, %v", got, err)
	}
	// Remembered, so it outlives security.json.
	got, err = o.publicURL(context.Background(), store, State{})
	if err != nil || got == nil || got.String() != "https://al.example.com" {
		t.Fatalf("the remembered address came back as %v, %v", got, err)
	}
	o.Public = "HTTPS://Al.Example.com:443/some/path"
	got, err = o.publicURL(context.Background(), memStore{}, State{})
	if err != nil || got.String() != "https://al.example.com" {
		t.Fatalf("the address from the environment came back as %v, %v", got, err)
	}
	o.Public = "al.example.com"
	if _, err := o.publicURL(context.Background(), memStore{}, State{}); err == nil {
		t.Fatal("an address without a scheme was taken")
	}
}

func TestTheResetCodeStandsApartInTheLog(t *testing.T) {
	in := newInstall(t)
	in.left(State{PasswordHash: in.hash("forgotten")})
	b := visit(t, in.start("", ""))
	if status, out := b.call("POST", signin.APIPrefix+"reset-code", nil); status != http.StatusOK {
		t.Fatalf("asking for a code answered %d %v", status, out)
	}
	printed := in.codes.String()
	if !strings.Contains(printed, "PASSWORD RESET CODE") {
		t.Fatalf("the code did not stand apart: %q", printed)
	}
	if strings.Contains(in.log.String(), strings.Fields(printed[strings.Index(printed, "CODE:")+5:])[0]) {
		t.Fatal("the code went into the ordinary log as well")
	}
}

// memStore is a signin.Store in memory for the tests that need no package.
type memStore map[string][]byte

func (m memStore) Get(_ context.Context, kind, id string) ([]byte, error) {
	if b, ok := m[kind+"/"+id]; ok {
		return b, nil
	}
	return nil, signin.ErrNotFound
}

func (m memStore) List(_ context.Context, kind string) ([]signin.Doc, error) {
	var out []signin.Doc
	for k, v := range m {
		if strings.HasPrefix(k, kind+"/") {
			out = append(out, signin.Doc{Kind: kind, ID: strings.TrimPrefix(k, kind+"/"), Data: v})
		}
	}
	return out, nil
}

func (m memStore) Apply(_ context.Context, docs ...signin.Doc) error {
	for _, d := range docs {
		if d.Data == nil {
			delete(m, d.Kind+"/"+d.ID)
			continue
		}
		m[d.Kind+"/"+d.ID] = d.Data
	}
	return nil
}
