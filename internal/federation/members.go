package federation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"net/http"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/relay"
)

// The rules a call from another member passes before it is served: whose key
// it is (see relay/member.go) and how much that key may ask at once.

const (
	// maxPinned is how many member keys a group keeps pinned, and maxWaiting
	// how many of them may wait for approval, so keys anybody holding the
	// words can make never fill the list and push out an instance the owner
	// approved.
	maxPinned  = 64
	maxWaiting = 16
	// maxNewPins is how many keys may be pinned within pinWindow, and
	// maxNewPinsPerSource how many of them may come through one relay
	// connection. A whole group pins its keys within minutes of being paired,
	// each member through its own connection. Every pin is a write of
	// group.json, and keys made only to be pinned would otherwise cost the
	// instance without end.
	maxNewPins          = 64
	maxNewPinsPerSource = 2
	pinWindow           = time.Hour
	// maxRevoked bounds the revoked keys kept; the oldest goes first.
	maxRevoked = 1024
	// perMemberCalls is how many calls one member key has served at once.
	perMemberCalls = 16
)

// Caller is the member a call came from: the id its pinned key speaks for.
type Caller struct {
	ID   string
	Kind string
	Key  []byte
}

type callerKey struct{}

// CallerOf returns the member a call into this instance came from, if it
// signed with a pinned key.
func CallerOf(ctx context.Context) (Caller, bool) {
	c, ok := ctx.Value(callerKey{}).(Caller)
	return c, ok
}

// refusal is how a call that is not served is answered.
type refusal struct {
	status int
	body   []byte
}

func refuse(status int, code, text string) *refusal {
	return &refusal{status: status, body: relay.RefusalBody(code, text)}
}

// removedRefusal answers a key that was taken out of the group, in the plain
// body the protocol's other members read it by.
var removedRefusal = &refusal{status: http.StatusGone, body: []byte("removed")}

// dropped is a call that gets no answer at all: one that is old, or one whose
// id its key already used.
var dropped = &refusal{status: relay.StatusDrop}

// memberLimits counts what each member has in flight and when keys were
// pinned, and through which source. It lives in memory and is set by this
// instance alone.
type memberLimits struct {
	mu       sync.Mutex
	inFlight map[string]int
	pinned   []newPin
}

type newPin struct {
	at     time.Time
	source string
}

func newMemberLimits() *memberLimits {
	return &memberLimits{inFlight: map[string]int{}}
}

// acquire counts one more call of key in flight and reports whether it may
// run; release ends it.
func (l *memberLimits) acquire(key []byte) (release func(), ok bool) {
	bucket := string(key)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.inFlight[bucket] >= perMemberCalls {
		return nil, false
	}
	l.inFlight[bucket]++
	return func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		if l.inFlight[bucket]--; l.inFlight[bucket] <= 0 {
			delete(l.inFlight, bucket)
		}
	}, true
}

// mayPin reports whether one more key may be pinned at now through source, and
// counts it. A transport that cannot tell its sources apart passes "", which
// only the group's hour counts.
func (l *memberLimits) mayPin(source string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	kept := l.pinned[:0]
	fromSource := 0
	for _, p := range l.pinned {
		if now.Sub(p.at) < pinWindow {
			kept = append(kept, p)
			if source != "" && p.source == source {
				fromSource++
			}
		}
	}
	l.pinned = kept
	if fromSource >= maxNewPinsPerSource || len(l.pinned) >= maxNewPins {
		return false
	}
	l.pinned = append(l.pinned, newPin{at: now, source: source})
	return true
}

// Guard wraps serve so every call from another member passes the group's key
// rules and limits first. It is also where a call's id is used up: only once
// the call is known to come from a pinned key, so a stranger fills no record a
// member needs.
func (m *Manager) Guard(serve relay.ProxyHandler) relay.ProxyHandler {
	return func(ctx context.Context, call relay.ProxyCall) (int, []byte) {
		caller, r := m.admit(call, relay.SourceOf(ctx), time.Now())
		if r != nil {
			return r.status, r.body
		}
		release, ok := m.limits.acquire(call.Key)
		if !ok {
			return http.StatusTooManyRequests, relay.RefusalBody("memberBusy",
				"this instance already has as many calls waiting here as it may; try again in a moment")
		}
		defer release()
		return serve(context.WithValue(ctx, callerKey{}, caller), call)
	}
}

// admit decides whose call this is. call comes from relay.OpenCall, so a
// signature it carries already holds; what is left is whether the id it names
// is the one its key makes and whether the call ran before. source is where
// the call came in, as relay.SourceOf says.
func (m *Manager) admit(call relay.ProxyCall, source string, now time.Time) (Caller, *refusal) {
	if !relay.Recent(call, now) {
		return Caller{}, dropped
	}
	if !call.Signed() {
		return Caller{}, unsignedRefusal
	}
	if call.From == "" {
		return Caller{}, refuse(http.StatusForbidden, "memberUnnamed", "a signed call has to name the member it comes from")
	}
	if !claimFits(call.From, call.Kind, call.Key) {
		return Caller{}, kindRefusal
	}
	m.group.mu.Lock()
	defer m.group.mu.Unlock()
	st := &m.group.state
	// Only a call whose key makes the id it names hears that the key is out,
	// since an instance that hears it leaves its group.
	if _, gone := st.Revoked[hex.EncodeToString(call.Key)]; gone {
		return Caller{}, removedRefusal
	}
	if pin, ok := st.Keys[call.From]; ok {
		if !m.replay.Admit(call) {
			return Caller{}, dropped
		}
		if now.Sub(pin.Used) >= lastSeenStep {
			pin.Used = now
			st.Keys[call.From] = pin
			_ = m.group.flushLocked()
		}
		if !pin.Approved {
			return Caller{}, pendingRefusal
		}
		return Caller{ID: call.From, Kind: pin.Kind, Key: pin.Key}, nil
	}
	for _, pin := range st.Keys {
		if bytes.Equal(pin.Key, call.Key) {
			return Caller{}, refuse(http.StatusForbidden, "memberKeyChanged",
				"this key already speaks for another member of the group")
		}
	}
	if waitingLocked(st) >= maxWaiting {
		return Caller{}, refuse(http.StatusTooManyRequests, "groupFull",
			"as many instances as this one lists already wait for approval; approve or refuse one under Settings, Pairing first")
	}
	if len(st.Keys) >= maxPinned {
		return Caller{}, refuse(http.StatusTooManyRequests, "groupFull",
			"this group already knows as many instances as it can; remove one under Settings, Pairing first")
	}
	if !m.limits.mayPin(source, now) {
		return Caller{}, refuse(http.StatusTooManyRequests, "groupJoinsBusy",
			"too many new instances joined this group within the hour; try again later")
	}
	if st.Keys == nil {
		st.Keys = map[string]PinnedKey{}
	}
	st.Keys[call.From] = PinnedKey{Key: bytes.Clone(call.Key), Kind: call.Kind, Used: now}
	if err := m.group.flushLocked(); err != nil {
		delete(st.Keys, call.From)
		return Caller{}, refuse(http.StatusInternalServerError, "memberNotPinned", "this instance could not record the other one's key")
	}
	m.replay.Admit(call)
	return Caller{}, pendingRefusal
}

// claimFits reports whether id is the one key makes for an instance
// (relay.MemberID). Whoever holds the words sees every member's id, and only
// this keeps them from pinning a key of their own under one. Every ArrowLoop
// is an instance, its phone app and desktop app included, so no other kind
// gets in.
func claimFits(id, kind string, key []byte) bool {
	return kind == relay.KindInstance && id != "" && relay.MemberID(kind, key) == id
}

// ApprovedInstance reports whether c signed with a key this instance holds
// pinned and approved. Only such a caller may decide who else is in the group.
func (m *Manager) ApprovedInstance(c Caller) bool {
	if len(c.Key) == 0 {
		return false
	}
	m.group.mu.Lock()
	defer m.group.mu.Unlock()
	pin, ok := m.group.state.Keys[c.ID]
	return ok && pin.Approved && pin.Kind == relay.KindInstance && relay.ValidInstanceID(c.ID) && bytes.Equal(pin.Key, c.Key)
}

// Approved reports whether instance id was let into the group here.
func (m *Manager) Approved(id string) bool {
	m.group.mu.Lock()
	defer m.group.mu.Unlock()
	return approvedInstanceLocked(&m.group.state, id)
}

// TrustsAnswer reports whether an answer signed by key may count as instance
// target's: target is approved here under that key. It is what the relay
// client asks before it hands an answer on, a "removed" included.
func (m *Manager) TrustsAnswer(target string, key ed25519.PublicKey) bool {
	return m.ApprovedInstance(Caller{ID: target, Kind: relay.KindInstance, Key: key})
}

// pendingRefusal answers a member whose key is pinned but nobody approved yet.
var pendingRefusal = refuse(http.StatusForbidden, "memberPending",
	"this instance waits for approval; approve it on an instance of the group under Settings, Pairing")

// unsignedRefusal answers a call without a member key.
var unsignedRefusal = refuse(http.StatusForbidden, "memberUnsigned",
	"this instance does not sign its calls, which every member of the group has to; update it")

// kindRefusal answers a signed call whose id is not the one its key makes for
// an instance.
var kindRefusal = refuse(http.StatusForbidden, "memberKind",
	"this call names an id that its key does not make for an instance")

// waitingLocked counts the pins that wait for approval.
func waitingLocked(st *GroupState) int {
	n := 0
	for _, pin := range st.Keys {
		if !pin.Approved {
			n++
		}
	}
	return n
}
