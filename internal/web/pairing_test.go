package web_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/federation"
	"github.com/junkerderprovinz/arrowloop/internal/pairing"
	"github.com/junkerderprovinz/arrowloop/internal/relay"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// node is one instance with its own engine, paired through a relay of the
// test's own.
type node struct {
	*harness
	server *web.Server
}

func newNode(t *testing.T, relayURL string) *node {
	t.Helper()
	return newNodeAs(t, relayURL, "server")
}

// newNodeAs is newNode for an instance that tells the group it is deployment.
func newNodeAs(t *testing.T, relayURL, deployment string) *node {
	t.Helper()
	h := newHarness(t)
	store, err := pairing.Open(h.dir, bytes.Repeat([]byte{3}, 32))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(func(st *pairing.State) error {
		st.RelayMode, st.RelayURL = pairing.ModeOwn, relayURL
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	group, err := federation.Load(h.dir)
	if err != nil {
		t.Fatal(err)
	}
	s := &web.Server{History: h.history, Runner: h.runner, Pairing: store, Group: group, Deployment: deployment}
	h.srv = httptest.NewServer(s.Handler())
	s.StartPairing()
	t.Cleanup(func() {
		s.StopPairing()
		h.srv.Close()
	})
	return &node{harness: h, server: s}
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
	if !strings.HasPrefix(made.Code, made.Phrase+"\n") {
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
	_, bID := pair(t, a, b)

	eventually(t, "the other instance's jobs on the overview", func() bool {
		rows := a.instances(t)
		return len(rows) == 1 && rows[0].ID == bID && rows[0].State == "ok" && len(rows[0].Jobs) == 1 && rows[0].Jobs[0].Name == "photos"
	})

	write(t, b.left, "a.txt", "from the cellar")
	if status, body := a.send(t, http.MethodPost, "/api/instances/"+bID+"/jobs/photos/run", ""); status != http.StatusAccepted {
		t.Fatalf("run on the other instance = %d %s", status, body)
	}
	waitForRun(t, b.harness, 1)

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
		return len(a.server.Group.PendingMembers()) == 1 && len(b.server.Group.PendingMembers()) == 1
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
