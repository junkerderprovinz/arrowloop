package web_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/lan"
	"github.com/junkerderprovinz/parleyport/kit/member"
	"github.com/junkerderprovinz/parleyport/kit/phrase"
	"github.com/junkerderprovinz/parleyport/kit/relay"

	"github.com/junkerderprovinz/arrowloop/internal/pairing"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// node is one instance with its own engine, paired through a relay of the
// test's own.
type node struct {
	*harness
	server *web.Server
	log    *lockedLog
}

// lockedLog keeps what a server logs, written from the goroutines that serve
// the group and read by the test.
type lockedLog struct {
	mu    sync.Mutex
	lines []string
}

func (l *lockedLog) printf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lines = append(l.lines, fmt.Sprintf(format, args...))
}

func (l *lockedLog) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Join(l.lines, "\n")
}

func newNode(t *testing.T, relayURL string) *node {
	t.Helper()
	return newNodeAs(t, relayURL, "server")
}

// newNodeAs is newNode for an instance that tells the group it is deployment.
func newNodeAs(t *testing.T, relayURL, deployment string) *node {
	t.Helper()
	return nodeOn(t, relayURL, deployment, newHarness(t))
}

// nodeOn makes an instance of the group out of an engine the test stood up.
func nodeOn(t *testing.T, relayURL, deployment string, h *harness) *node {
	t.Helper()
	return nodeWith(t, setup{relay: relayURL, deployment: deployment}, h)
}

// setup is how a test stands an instance up: on its relay, "" for none, on
// a network of the test's own, and from the files another release wrote.
type setup struct {
	relay      string
	deployment string
	lan        *lan.Service
	from       string
	// ports are where the instances it is told about by address listen,
	// besides its own.
	ports []int
}

func nodeWith(t *testing.T, su setup, h *harness) *node {
	t.Helper()
	if su.from != "" {
		for _, f := range []string{"pairing.json", "group.json"} {
			raw, err := os.ReadFile(filepath.Join(su.from, f))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(h.dir, f), raw, 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	store, err := pairing.Open(h.dir, bytes.Repeat([]byte{3}, 32))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(func(st *pairing.State) error {
		st.RelayMode, st.RelayURL = pairing.ModeOwn, su.relay
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	deployment := su.deployment
	if deployment == "" {
		deployment = "server"
	}
	log := &lockedLog{}
	s := &web.Server{History: h.history, Runner: h.runner, Pairing: store, LAN: su.lan, Deployment: deployment, Log: log.printf}
	h.srv = httptest.NewUnstartedServer(s.Handler())
	s.Ports = append(slices.Clone(su.ports), h.srv.Listener.Addr().(*net.TCPAddr).Port)
	if su.lan != nil {
		s.DirectURL = "http://" + h.srv.Listener.Addr().String()
	}
	h.srv.Start()
	s.StartPairing()
	t.Cleanup(func() {
		s.StopPairing()
		h.srv.Close()
	})
	return &node{harness: h, server: s, log: log}
}

func testRelay(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(relay.New())
	t.Cleanup(srv.Close)
	return srv.URL
}

// send makes one request with a JSON body and returns the answer.
func (n *node) send(t *testing.T, method, path, body string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, n.srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.srv.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out
}

type connectView struct {
	Active  bool   `json:"active"`
	Name    string `json:"name"`
	Members []struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Approved bool   `json:"approved"`
	} `json:"members"`
	Pending []struct {
		ID string `json:"id"`
	} `json:"pending"`
	Fingerprint string `json:"fingerprint"`
}

func (n *node) connect(t *testing.T) connectView {
	t.Helper()
	var v connectView
	n.get(t, "/api/connect", &v)
	return v
}

// eventually polls until cond holds; the frames it waits on cross a real
// socket into goroutines the test has no handle on.
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	// A call that gets lost on the way waits out the relay's timeout of
	// fifteen seconds before it is sent again.
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("%s never happened", what)
}

// pair makes a group of a and b, each approved on the other, and returns the
// id each goes by.
func pair(t *testing.T, a, b *node) (string, string) {
	t.Helper()
	status, body := a.send(t, http.MethodPost, "/api/connect/activate", "{}")
	if status != http.StatusOK {
		t.Fatalf("activate = %d %s", status, body)
	}
	var made struct {
		Phrase string `json:"phrase"`
		Code   string `json:"code"`
	}
	if err := json.Unmarshal(body, &made); err != nil || len(strings.Fields(made.Phrase)) != 12 {
		t.Fatalf("activate answered %s, want twelve words", body)
	}
	if a.relay(t).RelayURL != "" && !strings.HasPrefix(made.Code, made.Phrase+"\n") {
		t.Errorf("the code for the QR = %q, want the words and then this instance's own relay", made.Code)
	}
	if status, body := b.send(t, http.MethodPost, "/api/connect/join", `{"phrase":"`+made.Phrase+`"}`); status != http.StatusOK {
		t.Fatalf("join = %d %s", status, body)
	}
	if a.connect(t).Fingerprint == "" || b.connect(t).Fingerprint == "" {
		t.Fatal("an instance in a group shows no fingerprint")
	}

	// Each waits for approval on the other once they met, whichever entered
	// the words.
	eventually(t, "both instances waiting for approval on the other", func() bool {
		pendingA, pendingB := a.connect(t).Pending, b.connect(t).Pending
		return len(pendingA) == 1 && len(pendingB) == 1
	})
	aID, bID := b.connect(t).Pending[0].ID, a.connect(t).Pending[0].ID
	for _, step := range []struct {
		at *node
		id string
	}{{a, bID}, {b, aID}} {
		if status, body := step.at.send(t, http.MethodPost, "/api/connect/devices/"+step.id+"/approve", "{}"); status != http.StatusNoContent {
			t.Fatalf("approve = %d %s", status, body)
		}
	}
	return aID, bID
}

type instanceRow struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	State string `json:"state"`
	Jobs  []struct {
		Name string `json:"name"`
	} `json:"jobs"`
}

func (n *node) instances(t *testing.T) []instanceRow {
	t.Helper()
	var rows []instanceRow
	n.get(t, "/api/instances", &rows)
	return rows
}

func TestPairedInstancesSeeAndRunEachOthersJobs(t *testing.T) {
	url := testRelay(t)
	a, b := newNode(t, url), newNode(t, url)
	aID, bID := pair(t, a, b)

	eventually(t, "the other instance's jobs on the overview", func() bool {
		rows := a.instances(t)
		return len(rows) == 1 && rows[0].ID == bID && rows[0].State == "ok" && len(rows[0].Jobs) == 1 && rows[0].Jobs[0].Name == "photos"
	})

	write(t, b.left, "a.txt", "from the cellar")
	if status, body := a.send(t, http.MethodPost, "/api/instances/"+bID+"/jobs/photos/run", ""); status != http.StatusAccepted {
		t.Fatalf("run on the other instance = %d %s", status, body)
	}
	waitForRun(t, b.harness, 1)
	if logged := b.log.String(); !strings.Contains(logged, "photos") || !strings.Contains(logged, aID) {
		t.Errorf("the owner's log = %q, want the job and the instance that started it", logged)
	}

	if status, _ := a.send(t, http.MethodPost, "/api/instances/"+bID+"/jobs/photos/delete", ""); status != http.StatusNotFound {
		t.Errorf("another action than run or stop = %d, want 404", status)
	}
}

func TestAnInstanceIsServedOnlyOnceApproved(t *testing.T) {
	url := testRelay(t)
	a, b := newNode(t, url), newNode(t, url)
	status, body := a.send(t, http.MethodPost, "/api/connect/activate", "{}")
	if status != http.StatusOK {
		t.Fatalf("activate = %d %s", status, body)
	}
	var made struct{ Phrase string }
	_ = json.Unmarshal(body, &made)
	b.send(t, http.MethodPost, "/api/connect/join", `{"phrase":"`+made.Phrase+`"}`)

	eventually(t, "a waiting for approval on b", func() bool {
		pendingA, pendingB := a.connect(t).Pending, b.connect(t).Pending
		return len(pendingA) == 1 && len(pendingB) == 1
	})
	rows := a.instances(t)
	if len(rows) != 1 || rows[0].State != "approve" || len(rows[0].Jobs) != 0 {
		t.Fatalf("an instance nobody approved here = %+v, want it shown as waiting for approval, without jobs", rows)
	}
	bID := rows[0].ID
	if status, _ := a.send(t, http.MethodPost, "/api/instances/"+bID+"/jobs/photos/run", ""); status == http.StatusAccepted {
		t.Fatal("a run reached an instance this one never approved")
	}

	// Approved here, but still waiting there: b serves nothing yet.
	a.send(t, http.MethodPost, "/api/connect/devices/"+bID+"/approve", "{}")
	eventually(t, "a seeing that it waits on b", func() bool {
		rows := a.instances(t)
		return len(rows) == 1 && rows[0].State == "waiting"
	})
}

// Two instances meet as soon as both are on the relay, so a server nobody has
// the Pairing tile open on still lists the newcomer for approval.
func TestInstancesMeetWithoutTheirPairingTileOpen(t *testing.T) {
	url := testRelay(t)
	a, b := newNode(t, url), newNode(t, url)
	_, body := a.send(t, http.MethodPost, "/api/connect/activate", "{}")
	var made struct{ Phrase string }
	_ = json.Unmarshal(body, &made)
	b.send(t, http.MethodPost, "/api/connect/join", `{"phrase":"`+made.Phrase+`"}`)
	eventually(t, "each instance pinning the other", func() bool {
		return len(a.connect(t).Pending) == 1 && len(b.connect(t).Pending) == 1
	})
}

func TestTakingAnInstanceOutRevokesItEverywhere(t *testing.T) {
	url := testRelay(t)
	a, b := newNode(t, url), newNode(t, url)
	_, bID := pair(t, a, b)
	eventually(t, "the pair being served", func() bool {
		rows := a.instances(t)
		return len(rows) == 1 && rows[0].State == "ok"
	})

	if status, body := a.send(t, http.MethodDelete, "/api/connect/members/"+bID, ""); status != http.StatusNoContent {
		t.Fatalf("remove = %d %s", status, body)
	}
	eventually(t, "the instance taken out leaving its group", func() bool { return !b.connect(t).Active })
	eventually(t, "the overview forgetting it", func() bool { return len(a.instances(t)) == 0 })
}

func TestARenamedInstanceIsSeenUnderItsNewName(t *testing.T) {
	url := testRelay(t)
	a, b := newNode(t, url), newNode(t, url)
	pair(t, a, b)
	if status, body := b.send(t, http.MethodPut, "/api/connect", `{"name":"Cellar"}`); status != http.StatusOK {
		t.Fatalf("rename = %d %s", status, body)
	}
	eventually(t, "the new name on the other instance", func() bool {
		rows := a.instances(t)
		return len(rows) == 1 && rows[0].Name == "Cellar"
	})
	if status, _ := b.send(t, http.MethodPut, "/api/connect", `{"name":"`+strings.Repeat("x", 65)+`"}`); status != http.StatusBadRequest {
		t.Errorf("a name past 64 characters = %d, want 400", status)
	}
}

func TestThePhraseIsShownAgainAndAMistypedWordIsNamed(t *testing.T) {
	a := newNode(t, testRelay(t))
	if status, _ := a.send(t, http.MethodPost, "/api/connect/reveal", "{}"); status != http.StatusNotFound {
		t.Errorf("reveal outside a group = %d, want 404", status)
	}
	_, body := a.send(t, http.MethodPost, "/api/connect/activate", "{}")
	var made struct{ Phrase string }
	_ = json.Unmarshal(body, &made)
	if status, _ := a.send(t, http.MethodPost, "/api/connect/activate", "{}"); status != http.StatusConflict {
		t.Errorf("a second phrase while in a group = %d, want 409", status)
	}
	_, body = a.send(t, http.MethodPost, "/api/connect/reveal", "{}")
	var shown struct{ Phrase string }
	if err := json.Unmarshal(body, &shown); err != nil || shown.Phrase != made.Phrase {
		t.Fatalf("reveal = %s, want the phrase made", body)
	}

	b := newNode(t, testRelay(t))
	words := strings.Fields(made.Phrase)
	words[4] = "zzzz"
	status, body := b.send(t, http.MethodPost, "/api/connect/join", `{"phrase":"`+strings.Join(words, " ")+`"}`)
	var refused struct {
		Code   string
		Values struct{ Word, Position string }
	}
	_ = json.Unmarshal(body, &refused)
	if status != http.StatusBadRequest || refused.Code != "unknown_word" || refused.Values.Word != "zzzz" || refused.Values.Position != "5" {
		t.Errorf("a mistyped word = %d %s, want 400 naming word 5", status, body)
	}
	if b.connect(t).Active {
		t.Error("a phrase that did not read put the instance in a group")
	}
}

func TestTheRelayModeIsKept(t *testing.T) {
	a := newNode(t, testRelay(t))
	if status, body := a.send(t, http.MethodPut, "/api/relay/config", `{"mode":"elsewhere"}`); status != http.StatusBadRequest {
		t.Errorf("an unknown mode = %d %s, want 400", status, body)
	}
	if status, body := a.send(t, http.MethodPut, "/api/relay/config", `{"mode":"own","relayUrl":"ftp://relay.example"}`); status != http.StatusBadRequest {
		t.Errorf("a relay that is no web address = %d %s, want 400", status, body)
	}
	status, body := a.send(t, http.MethodPut, "/api/relay/config", `{"mode":"off"}`)
	var v struct {
		Mode     string `json:"mode"`
		RelayURL string `json:"relayUrl"`
	}
	_ = json.Unmarshal(body, &v)
	if status != http.StatusOK || v.Mode != "off" || v.RelayURL == "" {
		t.Errorf("switching the relay off = %d %s, want it off with the own address kept for later", status, body)
	}
}

// onOneNetwork is a multicast group no instance outside the test uses, on a
// port free right now, or a skip on a host that cannot join one.
func onOneNetwork(t *testing.T) func() *lan.Service {
	t.Helper()
	probe, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.LocalAddr().(*net.UDPAddr).AddrPort().Port()
	_ = probe.Close()
	group := netip.AddrPortFrom(netip.MustParseAddr("239.255.77.252"), port)
	if c, err := net.ListenMulticastUDP("udp4", nil, net.UDPAddrFromAddrPort(group)); err != nil {
		t.Skipf("this host cannot join a multicast group: %v", err)
	} else {
		_ = c.Close()
	}
	return func() *lan.Service {
		s := lan.New(lan.Config{Group: group})
		s.Start()
		t.Cleanup(func() { _ = s.Close() })
		return s
	}
}

func TestTwoInstancesOnOneNetworkPairWithoutARelay(t *testing.T) {
	network := onOneNetwork(t)
	a := nodeWith(t, setup{lan: network()}, newHarness(t))
	b := nodeWith(t, setup{lan: network()}, newHarness(t))
	if v := a.relay(t); v.RelayURL != "" || v.Connected {
		t.Fatalf("the instances of this test dial a relay: %+v", v)
	}
	_, bID := pair(t, a, b)

	eventually(t, "the other instance's jobs over the network", func() bool {
		rows := a.instances(t)
		return len(rows) == 1 && rows[0].ID == bID && rows[0].State == "ok" && len(rows[0].Jobs) == 1
	})
	write(t, b.left, "a.txt", "from the cellar")
	if status, body := a.send(t, http.MethodPost, "/api/instances/"+bID+"/jobs/photos/run", ""); status != http.StatusAccepted {
		t.Fatalf("run on the other instance = %d %s", status, body)
	}
	waitForRun(t, b.harness, 1)
}

// beforeKit is where the pairing package keeps the files ArrowLoop 2.6 wrote
// for alpha and bravo, two instances that approved each other.
var beforeKit = filepath.Join("..", "pairing", "testdata", "before-kit")

func TestInstancesPairedBeforeTheUpdateStillServeEachOther(t *testing.T) {
	url := testRelay(t)
	a := nodeWith(t, setup{relay: url, from: filepath.Join(beforeKit, "alpha")}, newHarness(t))
	b := nodeWith(t, setup{relay: url, from: filepath.Join(beforeKit, "bravo")}, newHarness(t))

	eventually(t, "each instance serving the other with nobody approving anything", func() bool {
		rowsA, rowsB := a.instances(t), b.instances(t)
		return len(rowsA) == 1 && rowsA[0].Name == "bravo" && rowsA[0].State == "ok" &&
			len(rowsB) == 1 && rowsB[0].Name == "alpha" && rowsB[0].State == "ok"
	})
	if c := a.connect(t); len(c.Pending) != 0 || !c.Active {
		t.Errorf("alpha after the update = %+v, want it in its group with nobody waiting", c)
	}
}

// older stands in for an instance that has not taken the update yet: it
// signs and seals as before and hears decisions only on the routes it always
// had, never on the kit's own.
type older struct {
	client *relay.Client
	id     string

	mu    sync.Mutex
	calls []relay.ProxyCall
}

func newOlder(t *testing.T, url string, secret []byte) *older {
	t.Helper()
	return newDevice(t, url, secret, member.KindInstance)
}

// newDevice is a member of kind on the relay at url that answers like older.
func newDevice(t *testing.T, url string, secret []byte, kind member.Kind) *older {
	t.Helper()
	id, err := member.NewIdentity(kind)
	if err != nil {
		t.Fatal(err)
	}
	self := relay.Announce{Name: "older", Deployment: "container"}
	if kind != member.KindInstance {
		self = relay.Announce{Name: "phone", Deployment: string(kind), Client: true}
	}
	o := &older{id: id.ID()}
	o.client, err = relay.NewClient(relay.ClientOptions{
		URL:      url,
		Key:      pairing.Domain.GroupKey(secret),
		FrameKey: pairing.Domain.FrameKey(secret),
		Signing:  pairing.Domain.Signing(),
		Self:     self,
		Identity: &id,
		Serve: func(_ context.Context, call relay.ProxyCall) (int, []byte) {
			o.mu.Lock()
			o.calls = append(o.calls, call)
			o.mu.Unlock()
			switch {
			case call.Method == http.MethodGet && call.Path == "/api/jobs":
				return http.StatusOK, []byte(`[{"name":"cellar"}]`)
			case call.Method == http.MethodPost && strings.HasPrefix(call.Path, "/api/connect/devices/"):
				return http.StatusNoContent, nil
			}
			return http.StatusNotFound, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	o.client.Start()
	t.Cleanup(func() { _ = o.client.Close() })
	return o
}

// heard is the first call from member from that method and path match.
func (o *older) heard(from, method, path string) (relay.ProxyCall, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for _, c := range o.calls {
		if c.From == from && c.Method == method && c.Path == path {
			return c, true
		}
	}
	return relay.ProxyCall{}, false
}

func (o *older) call(t *testing.T, target, method, path string, body []byte) (int, []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, status, err := o.client.Proxy(ctx, target, method, path, body)
	var untrusted *relay.UntrustedAnswer
	if errors.As(err, &untrusted) {
		return untrusted.Status, untrusted.Body
	}
	if err != nil {
		return 0, nil
	}
	return status, out
}

// secretOf is the secret behind the phrase n shows.
func secretOf(t *testing.T, n *node) []byte {
	t.Helper()
	_, body := n.send(t, http.MethodPost, "/api/connect/reveal", "{}")
	var shown struct{ Phrase string }
	if err := json.Unmarshal(body, &shown); err != nil {
		t.Fatal(err)
	}
	secret, err := phrase.Decode(shown.Phrase)
	if err != nil {
		t.Fatal(err)
	}
	return secret
}

// groupID is the id n goes by in its group, as its relay announces it.
func groupID(t *testing.T, o *older, name string) string {
	t.Helper()
	var id string
	eventually(t, name+" on the relay", func() bool {
		for _, s := range o.client.Siblings() {
			if s.Name == name {
				id = s.InstanceID
				return true
			}
		}
		return false
	})
	return id
}

func TestAnInstanceBeforeTheUpdateIsGreetedAndServed(t *testing.T) {
	url := testRelay(t)
	a := newNode(t, url)
	a.send(t, http.MethodPut, "/api/connect", `{"name":"alpha"}`)
	a.send(t, http.MethodPost, "/api/connect/activate", "{}")
	o := newOlder(t, url, secretOf(t, a))
	aID := groupID(t, o, "alpha")

	eventually(t, "the older instance waiting for approval", func() bool {
		status, body := o.call(t, aID, http.MethodGet, "/api/group/hello", nil)
		return status == http.StatusForbidden && strings.Contains(string(body), "memberPending")
	})
	if status, body := a.send(t, http.MethodPost, "/api/connect/devices/"+o.id+"/approve", "{}"); status != http.StatusNoContent {
		t.Fatalf("approve = %d %s", status, body)
	}
	if status, body := o.call(t, aID, http.MethodGet, "/api/group/hello", nil); status != http.StatusOK {
		t.Errorf("the older instance's greeting = %d %s, want it answered", status, body)
	}
	eventually(t, "the older instance's jobs on the overview", func() bool {
		rows := a.instances(t)
		return len(rows) == 1 && rows[0].ID == o.id && rows[0].State == "ok" && len(rows[0].Jobs) == 1
	})
}

func TestAnApprovalReachesAnInstanceBeforeTheUpdate(t *testing.T) {
	url := testRelay(t)
	a, b := newNode(t, url), newNode(t, url)
	a.send(t, http.MethodPut, "/api/connect", `{"name":"alpha"}`)
	b.send(t, http.MethodPut, "/api/connect", `{"name":"bravo"}`)
	a.send(t, http.MethodPost, "/api/connect/activate", "{}")
	o := newOlder(t, url, secretOf(t, a))
	aID := groupID(t, o, "alpha")
	o.call(t, aID, http.MethodGet, "/api/group/hello", nil)
	eventually(t, "the older instance waiting on a", func() bool { return len(a.connect(t).Pending) == 1 })
	a.send(t, http.MethodPost, "/api/connect/devices/"+o.id+"/approve", "{}")

	b.send(t, http.MethodPost, "/api/connect/join", `{"phrase":"`+phraseOf(t, a)+`"}`)
	bID := groupID(t, o, "bravo")
	eventually(t, "b waiting on a", func() bool { return len(a.connect(t).Pending) == 1 })
	if status, body := a.send(t, http.MethodPost, "/api/connect/devices/"+bID+"/approve", "{}"); status != http.StatusNoContent {
		t.Fatalf("approve = %d %s", status, body)
	}
	eventually(t, "the older instance hearing a's approval of b on its own route", func() bool {
		_, ok := o.heard(aID, http.MethodPost, "/api/connect/devices/"+bID+"/approve")
		return ok
	})
	passed, _ := o.heard(aID, http.MethodPost, "/api/connect/devices/"+bID+"/approve")
	var decision struct {
		Key  []byte `json:"key"`
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(passed.Body, &decision); err != nil || member.ID(member.KindInstance, decision.Key) != bID || decision.Kind != "instance" {
		t.Errorf("the approval passed on = %s, want b's key and kind", passed.Body)
	}
}

func TestAnApprovalFromAnInstanceBeforeTheUpdateIsTaken(t *testing.T) {
	url := testRelay(t)
	a, b := newNode(t, url), newNode(t, url)
	a.send(t, http.MethodPut, "/api/connect", `{"name":"alpha"}`)
	b.send(t, http.MethodPut, "/api/connect", `{"name":"bravo"}`)
	a.send(t, http.MethodPost, "/api/connect/activate", "{}")
	o := newOlder(t, url, secretOf(t, a))
	aID := groupID(t, o, "alpha")
	o.call(t, aID, http.MethodGet, "/api/group/hello", nil)
	eventually(t, "the older instance waiting on a", func() bool { return len(a.connect(t).Pending) == 1 })
	a.send(t, http.MethodPost, "/api/connect/devices/"+o.id+"/approve", "{}")

	b.send(t, http.MethodPost, "/api/connect/join", `{"phrase":"`+phraseOf(t, a)+`"}`)
	bID := groupID(t, o, "bravo")
	eventually(t, "b greeting a and the older instance", func() bool {
		_, ok := o.heard(bID, http.MethodGet, "/kit/group/v1/hello")
		return ok && len(a.connect(t).Pending) == 1
	})
	greeting, _ := o.heard(bID, http.MethodGet, "/kit/group/v1/hello")
	passed, _ := json.Marshal(map[string]any{"key": greeting.Key, "kind": greeting.Kind})
	if status, body := o.call(t, aID, http.MethodPost, "/api/connect/devices/"+bID+"/approve", passed); status != http.StatusNoContent {
		t.Fatalf("an approval the older instance passed on = %d %s", status, body)
	}
	for _, m := range a.connect(t).Members {
		if m.ID == bID && !m.Approved {
			t.Errorf("a lists b as %+v after the older instance approved it, want it approved", m)
		}
	}
	if len(a.connect(t).Pending) != 0 {
		t.Error("b still waits on a")
	}
}

// phraseOf is the phrase n shows.
func phraseOf(t *testing.T, n *node) string {
	t.Helper()
	_, body := n.send(t, http.MethodPost, "/api/connect/reveal", "{}")
	var shown struct{ Phrase string }
	if err := json.Unmarshal(body, &shown); err != nil {
		t.Fatal(err)
	}
	return shown.Phrase
}

// The Pairing tab names a mistyped word before anything is sent, from its own
// copy of the list, so a word it lets through has to be one the server takes.
func TestTheWebUIChecksWordsAgainstThePhraseList(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "web", "src", "lib", "bip39-english.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := strings.Fields(string(raw)), phrase.Wordlist(); !slices.Equal(got, want) {
		t.Fatal("web/src/lib/bip39-english.txt differs from the kit's word list; copy the list across")
	}
}

// ArrowLoop has no phone app of another kind, so a device that signs as one
// holds the phrase and nothing else. It is turned away and never listed, so it
// cannot fill the places for instances waiting to be approved.
func TestADeviceOfAnotherKindIsTurnedAway(t *testing.T) {
	url := testRelay(t)
	a := newNode(t, url)
	a.send(t, http.MethodPut, "/api/connect", `{"name":"alpha"}`)
	a.send(t, http.MethodPost, "/api/connect/activate", "{}")
	phone := newDevice(t, url, secretOf(t, a), member.KindMobile)
	aID := groupID(t, phone, "alpha")

	for range 3 {
		if status, body := phone.call(t, aID, http.MethodGet, "/api/jobs", nil); status == http.StatusOK || status == http.StatusForbidden && strings.Contains(string(body), "memberPending") {
			t.Fatalf("a device of another kind = %d %s, want it turned away", status, body)
		}
	}
	if pending := a.connect(t).Pending; len(pending) != 0 {
		t.Errorf("waiting = %+v, want nobody", pending)
	}
}

// portOf is the port of a test server's address.
func portOf(t *testing.T, raw string) int {
	t.Helper()
	_, port, err := net.SplitHostPort(strings.TrimPrefix(raw, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	n, err := strconv.Atoi(port)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// addressOf is n's address as an owner would type it, without the scheme.
func addressOf(n *node) string { return strings.TrimPrefix(n.srv.URL, "http://") }

type addressAnswer struct {
	Code      string   `json:"code"`
	Addresses []string `json:"addresses"`
	Member    struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		State string `json:"state"`
	} `json:"member"`
}

func (n *node) addAddress(t *testing.T, address string) (int, addressAnswer) {
	t.Helper()
	status, body := n.send(t, http.MethodPost, "/api/connect/addresses", `{"address":"`+address+`"}`)
	var out addressAnswer
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("POST /api/connect/addresses = %d %s", status, body)
	}
	return status, out
}

// A desktop app takes no calls from the network, and a DNS filter may keep
// the relay away, so an address typed in is how it finds a server at home.
func TestAnAddressTypedInFindsAnInstanceWithoutTheRelay(t *testing.T) {
	a := nodeWith(t, setup{}, newHarness(t))
	a.send(t, http.MethodPut, "/api/connect", `{"name":"alpha"}`)
	b := nodeWith(t, setup{deployment: "desktop", ports: []int{portOf(t, a.srv.URL)}}, newHarness(t))
	b.send(t, http.MethodPost, "/api/connect/join", `{"phrase":"`+phraseOfNew(t, a)+`"}`)

	status, found := b.addAddress(t, addressOf(a))
	if status != http.StatusOK || found.Member.Name != "alpha" || found.Member.State != "pending" {
		t.Fatalf("adding alpha's address = %d %+v, want alpha found and waiting for approval", status, found)
	}
	if len(found.Addresses) != 1 || found.Addresses[0] != a.srv.URL {
		t.Errorf("known addresses = %q, want %s", found.Addresses, a.srv.URL)
	}
	eventually(t, "b greeting a at the address", func() bool { return len(a.connect(t).Pending) == 1 })
	b.send(t, http.MethodPost, "/api/connect/devices/"+found.Member.ID+"/approve", "{}")
	a.send(t, http.MethodPost, "/api/connect/devices/"+a.connect(t).Pending[0].ID+"/approve", "{}")
	eventually(t, "a's jobs on b", func() bool {
		rows := b.instances(t)
		return len(rows) == 1 && rows[0].Name == "alpha" && rows[0].State == "ok"
	})

	// The list goes, and the address b reached a at stays remembered.
	if status, body := b.send(t, http.MethodPut, "/api/connect/addresses", `{"addresses":[]}`); status != http.StatusOK {
		t.Fatalf("emptying the list = %d %s", status, body)
	}
	b.server.StopPairing()
	b.server.StartPairing()
	eventually(t, "a's jobs on b after a restart, at the address it remembered", func() bool {
		rows := b.instances(t)
		return len(rows) == 1 && rows[0].State == "ok"
	})
}

// A container may be mapped to any port of its host, so a typed address may
// name any port as long as it stays in the own network.
func TestATypedAddressMayNameAnyPort(t *testing.T) {
	a := nodeWith(t, setup{}, newHarness(t))
	a.send(t, http.MethodPut, "/api/connect", `{"name":"alpha"}`)
	b := nodeWith(t, setup{deployment: "desktop"}, newHarness(t))
	b.send(t, http.MethodPost, "/api/connect/join", `{"phrase":"`+phraseOfNew(t, a)+`"}`)

	if status, found := b.addAddress(t, addressOf(a)); status != http.StatusOK || found.Member.Name != "alpha" {
		t.Errorf("alpha on a port of its own = %d %+v, want it found", status, found)
	}
}

func TestATypedAddressSaysWhyItFindsNoInstance(t *testing.T) {
	dead := httpDeadPort(t)
	stranger := nodeWith(t, setup{}, newHarness(t))
	stranger.send(t, http.MethodPost, "/api/connect/activate", "{}")
	a := nodeWith(t, setup{ports: []int{dead, portOf(t, stranger.srv.URL)}}, newHarness(t))
	a.send(t, http.MethodPost, "/api/connect/activate", "{}")

	for _, tc := range []struct{ address, code string }{
		{"8.8.8.8:8422", "addressNotNearby"},
		{"ftp://192.168.1.10", "addressNotNearby"},
		{"127.0.0.1:" + strconv.Itoa(dead), "addressUnreachable"},
		{addressOf(stranger), "addressStranger"},
		{addressOf(a), "addressSelf"},
	} {
		status, out := a.addAddress(t, tc.address)
		if status != http.StatusBadRequest || out.Code != tc.code {
			t.Errorf("%s = %d %q, want 400 %s", tc.address, status, out.Code, tc.code)
		}
	}
	if status, body := a.send(t, http.MethodPut, "/api/connect/addresses", `{"addresses":["8.8.8.8:8422"]}`); status != http.StatusBadRequest || !strings.Contains(string(body), "addressNotNearby") {
		t.Errorf("a list with an address far away = %d %s, want 400 addressNotNearby", status, body)
	}
	if got := a.connectAddresses(t); len(got) != 0 {
		t.Errorf("known addresses = %q after refusals, want none", got)
	}
}

func (n *node) connectAddresses(t *testing.T) []string {
	t.Helper()
	var v struct {
		Addresses []string `json:"addresses"`
	}
	n.get(t, "/api/connect", &v)
	return v.Addresses
}

// httpDeadPort is a port on the loopback nothing listens on.
func httpDeadPort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	return port
}

// phraseOfNew puts n in a group of its own and returns its phrase.
func phraseOfNew(t *testing.T, n *node) string {
	t.Helper()
	n.send(t, http.MethodPost, "/api/connect/activate", "{}")
	return phraseOf(t, n)
}

// stream reads n's event stream until the test ends and hands each frame's
// data to a channel.
func stream(t *testing.T, n *node) <-chan string {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, n.srv.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := n.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	frames := make(chan string, 64)
	go func() {
		defer resp.Body.Close()
		lines := bufio.NewScanner(resp.Body)
		for lines.Scan() {
			if data, ok := strings.CutPrefix(lines.Text(), "data: "); ok {
				select {
				case frames <- data:
				default:
				}
			}
		}
	}()
	return frames
}

// The Pairing tile follows the group on the event stream rather than asking
// again every few seconds.
func TestTheEventStreamSaysWhenTheGroupChanges(t *testing.T) {
	url := testRelay(t)
	a, b := newNode(t, url), newNode(t, url)
	a.send(t, http.MethodPost, "/api/connect/activate", "{}")
	frames := stream(t, a)

	b.send(t, http.MethodPost, "/api/connect/join", `{"phrase":"`+phraseOf(t, a)+`"}`)
	deadline := time.After(30 * time.Second)
	for {
		select {
		case data := <-frames:
			var ev struct{ Job, Phase string }
			if json.Unmarshal([]byte(data), &ev) == nil && ev.Phase == web.GroupChanged && ev.Job == "" {
				return
			}
		case <-deadline:
			t.Fatal("a's event stream never said that another instance came")
		}
	}
}

// groupEvent waits for a group event on frames.
func groupEvent(t *testing.T, frames <-chan string, what string) {
	t.Helper()
	deadline := time.After(30 * time.Second)
	for {
		select {
		case data := <-frames:
			var ev struct{ Job, Phase string }
			if json.Unmarshal([]byte(data), &ev) == nil && ev.Phase == web.GroupChanged && ev.Job == "" {
				return
			}
		case <-deadline:
			t.Fatalf("the event stream never said %s", what)
		}
	}
}

// The Pairing tile shows whether the relay is reachable, so losing it is a
// change the clients hear of like any other.
func TestARelayThatGoesAwayReachesTheEventStream(t *testing.T) {
	r := relay.New()
	var down atomic.Bool
	r.Admit = func(string) bool { return !down.Load() }
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	a := newNode(t, srv.URL)
	a.send(t, http.MethodPost, "/api/connect/activate", "{}")
	eventually(t, "a on the relay", func() bool { return a.relay(t).Connected })
	frames := stream(t, a)

	// A socket the relay took over outlives the test server's Close, so the
	// relay itself turns everybody away.
	down.Store(true)
	r.Revoke()
	groupEvent(t, frames, "that the relay went away")
	if a.relay(t).Connected {
		t.Error("the relay still counts as connected")
	}
}
