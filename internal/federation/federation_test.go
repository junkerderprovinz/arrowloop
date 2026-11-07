package federation

import (
	"context"
	"errors"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/relay"
)

// fakeRelay stands in for *relay.Client and records the last call it was asked
// to make.
type fakeRelay struct {
	sibs []relay.Announce

	target, method, path string
	body                 []byte

	resp   []byte
	status int
	err    error

	// down makes Connected report false: a relay that is configured but
	// unreachable.
	down   bool
	closed bool
}

func (f *fakeRelay) Siblings() []relay.Announce { return f.sibs }

func (f *fakeRelay) Connected() bool { return !f.down }

func (f *fakeRelay) Proxy(_ context.Context, target, method, path string, body []byte) ([]byte, int, error) {
	f.target, f.method, f.path, f.body = target, method, path, body
	return f.resp, f.status, f.err
}

func (f *fakeRelay) Close() error {
	f.closed = true
	return nil
}

// Member ids in the shape instances mint them, the only one a member is
// listed under.
var (
	bravoID  = strings.Repeat("b", 40)
	nasID    = strings.Repeat("d", 40)
	laptopID = strings.Repeat("e", 40)
)

func newManager(t *testing.T) *Manager {
	t.Helper()
	m, err := Load(t.TempDir())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	return m
}

func TestMembersAreWhoTheRelaySeesAndNothingIsStored(t *testing.T) {
	dir := t.TempDir()
	m, err := Load(dir)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	rt := &fakeRelay{sibs: []relay.Announce{
		{InstanceID: bravoID, Name: "Laptop", Deployment: "desktop"},
	}}
	m.SetRelay(rt)

	list := m.Members()
	if len(list) != 1 || list[0].ID != bravoID || list[0].Name != "Laptop" {
		t.Fatalf("got %+v, want one member addressed by its id and named Laptop", list)
	}
	if _, err := os.Stat(filepath.Join(dir, "group.json")); !os.IsNotExist(err) {
		t.Errorf("group.json exists, want a member that is only passing never written to disk")
	}

	rt.sibs = nil
	if list := m.Members(); len(list) != 0 {
		t.Errorf("got %+v, want no members once the relay sees none", list)
	}
	m.SetRelay(nil)
	if list := m.Members(); len(list) != 0 {
		t.Errorf("got %+v, want no members with the relay switched off", list)
	}
	if !rt.closed {
		t.Error("SetRelay(nil) never closed the transport it replaced")
	}
}

func TestAMemberCarriesWhatItAnnounced(t *testing.T) {
	m := newManager(t)
	m.SetRelay(&fakeRelay{sibs: []relay.Announce{
		{InstanceID: nasID, Name: "NAS", Deployment: "container", Address: "https://al.example.org"},
		{InstanceID: laptopID, Name: "Laptop", Deployment: "desktop"},
	}})
	addresses, kinds := map[string]string{}, map[string]string{}
	for _, in := range m.Members() {
		addresses[in.Name] = in.Address
		kinds[in.Name] = in.Deployment
	}
	if !maps.Equal(addresses, map[string]string{"NAS": "https://al.example.org", "Laptop": ""}) {
		t.Errorf("addresses = %v, want the NAS at its domain and the laptop without one", addresses)
	}
	if !maps.Equal(kinds, map[string]string{"NAS": "container", "Laptop": "desktop"}) {
		t.Errorf("deployments = %v, want what each announced", kinds)
	}
}

func TestSetRelayClosesTheTransportItReplaces(t *testing.T) {
	m := newManager(t)
	first := &fakeRelay{}
	second := &fakeRelay{}

	m.SetRelay(first)
	if first.closed {
		t.Fatal("the transport was closed before anything replaced it")
	}
	m.SetRelay(second)
	if !first.closed {
		t.Error("the old transport was never closed when a new one replaced it")
	}
	if second.closed {
		t.Error("the new transport was closed immediately after being installed")
	}
}

func TestProxyReachesAMemberThroughTheTransport(t *testing.T) {
	m := newManager(t)
	rt := &fakeRelay{
		sibs:   []relay.Announce{{InstanceID: bravoID, Name: "Laptop"}},
		resp:   []byte(`{"started":true}`),
		status: http.StatusAccepted,
	}
	m.SetRelay(rt)

	body, code, err := m.Proxy(context.Background(), bravoID, http.MethodPost, "/api/jobs/Photos/run", []byte(`{}`))
	if err != nil {
		t.Fatalf("proxy: %v", err)
	}
	if code != http.StatusAccepted || string(body) != `{"started":true}` {
		t.Errorf("got %d %s, want the member's own answer", code, body)
	}
	if rt.target != bravoID || rt.method != http.MethodPost || rt.path != "/api/jobs/Photos/run" || string(rt.body) != `{}` {
		t.Errorf("the transport was asked for %s %s %s %s, want the call unchanged and addressed by id",
			rt.target, rt.method, rt.path, rt.body)
	}
	if _, code, err := m.Proxy(context.Background(), "Laptop", http.MethodGet, "/api/jobs", nil); !errors.Is(err, ErrUnknownInstance) || code != http.StatusNotFound {
		t.Errorf("got %d %v proxying by the name, want a 404; names never route", code, err)
	}
}

func TestAnInstanceThatLeftIsNotCalled(t *testing.T) {
	m := newManager(t)
	rt := &fakeRelay{sibs: []relay.Announce{{InstanceID: bravoID, Name: "Laptop"}}}
	m.SetRelay(rt)
	rt.sibs = nil
	if _, code, err := m.Proxy(context.Background(), bravoID, http.MethodGet, "/api/jobs", nil); err == nil || code != http.StatusNotFound {
		t.Fatalf("got %d %v, want a 404 for a member the relay no longer sees", code, err)
	}
	if rt.target != "" {
		t.Errorf("the transport was asked to call %q anyway", rt.target)
	}
}

// A sibling that serves no API, such as KnightLoader's phone app on the same
// relay, would be a member that answers nothing.
func TestClientOnlySiblingsAreNotListed(t *testing.T) {
	m := newManager(t)
	m.SetRelay(&fakeRelay{sibs: []relay.Announce{
		{InstanceID: nasID, Name: "Cellar", Deployment: "container"},
		{InstanceID: "id-phone", Name: "Pixel", Deployment: "mobile", Client: true},
	}})
	if list := m.Members(); len(list) != 1 || list[0].ID != nasID {
		t.Fatalf("got %+v, want only the instance", list)
	}
}

func TestAMemberIsListedOnlyUnderAnInstanceID(t *testing.T) {
	m := newManager(t)
	m.SetRelay(&fakeRelay{sibs: []relay.Announce{
		{InstanceID: "Laptop", Name: "Laptop"},
		{InstanceID: strings.ToUpper(bravoID), Name: "Laptop"},
		{InstanceID: bravoID, Name: "Laptop"},
	}})
	if list := m.Members(); len(list) != 1 || list[0].ID != bravoID {
		t.Fatalf("listed %+v, want only the member whose id is shaped like an instance's", list)
	}
}

func TestRelayConnectedTellsUnreachableFromEmpty(t *testing.T) {
	m := newManager(t)
	if m.RelayConnected() {
		t.Error("no relay configured at all, want RelayConnected false")
	}
	m.SetRelay(&fakeRelay{})
	if !m.RelayConnected() {
		t.Error("relay up with no siblings, want RelayConnected true")
	}
	m.SetRelay(&fakeRelay{down: true})
	if m.RelayConnected() {
		t.Error("relay configured but down, want RelayConnected false")
	}
}
