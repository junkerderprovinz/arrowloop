// Package federation lets one ArrowLoop show and run the jobs of the others a
// person paired with it. Instances that share a pairing phrase meet on the
// relay, and each one calls the others' REST API through it, sealed end to end
// and signed with a key of its own. It follows KnightLoader's package of the
// same name.
package federation

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/relay"
)

// Instance is another member of this instance's group, reachable through the
// relay right now.
type Instance struct {
	// ID is the member's instance id, which routes address it by
	// (/api/instances/{id}/...). Its announced name is not used for that,
	// since two instances may share or change one.
	ID   string `json:"id"`
	Name string `json:"name"`
	// Address is where the member's web interface is, as it announced it.
	Address string `json:"address,omitempty"`
	// Deployment is what the member announced itself as: "container",
	// "server", "desktop" or "phone".
	Deployment string `json:"deployment,omitempty"`
}

// RelayTransport is the relay client as this package uses it. It is an
// interface so tests can run members without a socket; *relay.Client
// satisfies it as is.
type RelayTransport interface {
	// Siblings is the instances the relay makes visible now; empty while the
	// relay is unreachable.
	Siblings() []relay.Announce
	// Proxy calls one sibling by instance id and returns its answer once the
	// sibling's key signed it.
	Proxy(ctx context.Context, target, method, path string, body []byte) ([]byte, int, error)
	// Connected reports whether the socket to the relay is up. Siblings alone
	// cannot tell an unreachable relay from one where nobody else is on the
	// key.
	Connected() bool
	// Close stops the connection for good.
	Close() error
}

// Manager keeps where this instance stands in its group and talks to the other
// members.
type Manager struct {
	mu sync.Mutex
	rt RelayTransport // nil while no relay is configured

	group  *groupFile
	replay *relay.ReplayGuard
	limits *memberLimits
	// awaiting is when each member last answered that this instance waits
	// for approval there, heard which members served a call from it, and
	// greeted when Greet last called each.
	awaiting map[string]time.Time
	heard    map[string]bool
	greeted  map[string]time.Time
}

// Load reads group.json from dir. A missing file is no group; a damaged one is
// an error.
func Load(dir string) (*Manager, error) {
	group, err := loadGroupFile(filepath.Join(dir, "group.json"))
	if err != nil {
		return nil, err
	}
	return &Manager{
		group:  group,
		replay: relay.NewReplayGuard(),
		limits: newMemberLimits(),
	}, nil
}

// RelayConnected reports whether a relay is configured and its socket is up.
func (m *Manager) RelayConnected() bool {
	m.mu.Lock()
	rt := m.rt
	m.mu.Unlock()
	return rt != nil && rt.Connected()
}

// SetRelay installs the transport, or clears it with nil, and closes the one
// it replaces so repeated saves do not leak connections.
func (m *Manager) SetRelay(rt RelayTransport) {
	m.mu.Lock()
	prev := m.rt
	m.rt = rt
	m.mu.Unlock()
	if prev != nil {
		_ = prev.Close()
	}
}

// Members returns the other instances of the group reachable now, sorted by
// name. A sibling that announces itself as a client, or under an id no
// instance has, is left out: it serves no API to call.
func (m *Manager) Members() []Instance {
	m.mu.Lock()
	rt := m.rt
	m.mu.Unlock()
	if rt == nil {
		return nil
	}
	var out []Instance
	for _, sib := range rt.Siblings() {
		if sib.Client || !relay.ValidInstanceID(sib.InstanceID) {
			continue
		}
		out = append(out, Instance{ID: sib.InstanceID, Name: sib.Name, Address: sib.Address, Deployment: sib.Deployment})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// ErrUnknownInstance is what Proxy answers for an id no member reachable now
// goes by.
var ErrUnknownInstance = errors.New("federation: no instance of the group goes by that id right now")

// Proxy calls a member's API and returns its answer. The member's key signs
// the answer, and the relay client hands it on only once that holds, so a
// stranger holding the words who takes the member's place cannot answer for
// it.
func (m *Manager) Proxy(ctx context.Context, id, method, path string, body []byte) ([]byte, int, error) {
	m.mu.Lock()
	rt := m.rt
	m.mu.Unlock()
	found := false
	for _, in := range m.Members() {
		found = found || in.ID == id
	}
	if rt == nil || !found {
		return nil, http.StatusNotFound, fmt.Errorf("%w: %s", ErrUnknownInstance, id)
	}
	out, code, err := rt.Proxy(ctx, id, method, path, body)
	var untrusted *relay.UntrustedAnswer
	switch {
	case err == nil:
		m.noteAnswer(id, code, out, time.Now())
	case errors.As(err, &untrusted) && waitsForApproval(untrusted.Status, untrusted.Body):
		// The member has not been approved here yet either, which is how two
		// instances meet; that this one waits there is all its answer is
		// taken for.
		m.noteAnswer(id, untrusted.Status, untrusted.Body, time.Now())
	}
	return out, code, err
}
