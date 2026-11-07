package federation

import (
	"context"
	"crypto/ed25519"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/relay"
)

func TestANewInstanceIsRefusedUntilApproved(t *testing.T) {
	m, serve := guarded(t)
	laptop := memberKeyOf(20)
	laptopID := idOf(laptop, relay.KindInstance)
	for range 2 {
		if status, body := serve(context.Background(), callAs(laptop, relay.KindInstance)); status != http.StatusForbidden || codeOf(body) != "memberPending" {
			t.Fatalf("a new instance = %d %s, want 403 memberPending", status, body)
		}
	}
	pending := m.PendingMembers()
	if len(pending) != 1 || pending[0].ID != laptopID || pending[0].Kind != relay.KindInstance || pending[0].Fingerprint != relay.Fingerprint(laptop.Public().(ed25519.PublicKey)) {
		t.Fatalf("pending = %+v, want the laptop with its fingerprint", pending)
	}
	key, kind, err := m.Approve(laptopID, nil, "")
	if err != nil || kind != relay.KindInstance || string(key) != string(laptop.Public().(ed25519.PublicKey)) {
		t.Fatalf("approve = %x %q %v, want the laptop's key and kind to pass on", key, kind, err)
	}
	if status, _ := serve(context.Background(), callAs(laptop, relay.KindInstance)); status != http.StatusOK {
		t.Fatalf("the approved instance = %d, want 200", status)
	}
	if len(m.PendingMembers()) != 0 {
		t.Error("the approved instance is still listed as waiting")
	}
	if _, _, err := m.Approve(idOf(memberKeyOf(19), relay.KindInstance), nil, ""); err != ErrNoSuchPending {
		t.Errorf("approving an id nobody pinned = %v, want ErrNoSuchPending", err)
	}
}

// TestAnApprovalPassedOnLetsTheInstanceInBeforeItCalls is the second
// instance's side: the approval arrives with the key, and the new instance's
// first call there is served under it while another key in its name is not.
func TestAnApprovalPassedOnLetsTheInstanceInBeforeItCalls(t *testing.T) {
	m, serve := guarded(t)
	laptop := memberKeyOf(21)
	laptopID := idOf(laptop, relay.KindInstance)
	if _, _, err := m.Approve(laptopID, laptop.Public().(ed25519.PublicKey), relay.KindInstance); err != nil {
		t.Fatal(err)
	}
	if status, _ := serve(context.Background(), callAs(laptop, relay.KindInstance)); status != http.StatusOK {
		t.Fatalf("the instance approved elsewhere = %d, want 200", status)
	}
	if status, body := serve(context.Background(), signedCall(memberKeyOf(22), laptopID, relay.KindInstance)); codeOf(body) != "memberKind" {
		t.Errorf("another key in its name = %d %s, want memberKind", status, body)
	}
	if _, _, err := m.Approve(laptopID, memberKeyOf(22).Public().(ed25519.PublicKey), relay.KindInstance); err != ErrKeyMismatch {
		t.Errorf("an approval passed on for another key = %v, want ErrKeyMismatch", err)
	}
}

func TestARefusedInstanceStaysOutAndComesBackOnlyAsANewOneWaiting(t *testing.T) {
	m, serve := guarded(t)
	laptop := memberKeyOf(23)
	laptopID := idOf(laptop, relay.KindInstance)
	serve(context.Background(), callAs(laptop, relay.KindInstance))
	if err := m.Refuse(laptopID, time.Now()); err != nil {
		t.Fatal(err)
	}
	if status, body := serve(context.Background(), callAs(laptop, relay.KindInstance)); status != http.StatusGone || string(body) != "removed" {
		t.Errorf("the refused instance = %d %s, want 410 removed", status, body)
	}
	if _, _, err := m.Approve(laptopID, laptop.Public().(ed25519.PublicKey), relay.KindInstance); err != ErrGone {
		t.Errorf("approving the refused key afterwards = %v, want ErrGone", err)
	}
	if status, body := serve(context.Background(), callAs(memberKeyOf(24), relay.KindInstance)); codeOf(body) != "memberPending" {
		t.Errorf("the instance with a new key = %d %s, want it waiting for approval", status, body)
	}
}

func unsignedCall(from string) relay.ProxyCall {
	return relay.ProxyCall{Method: http.MethodGet, Path: "/api/jobs", From: from, ID: nextCallID(), Sent: time.Now().Unix()}
}

// TestNoCallWithoutAKeyIsServed holds every member to signing, in a group or
// outside one, known or not.
func TestNoCallWithoutAKeyIsServed(t *testing.T) {
	m, serve := guarded(t)
	known := letIn(t, m, serve, memberKeyOf(30), relay.KindInstance)
	outside := newManager(t).Guard(func(context.Context, relay.ProxyCall) (int, []byte) { return http.StatusOK, nil })
	for _, from := range []string{"", known, idOf(memberKeyOf(31), relay.KindInstance), nasID} {
		for name, s := range map[string]relay.ProxyHandler{"in a group": serve, "outside a group": outside} {
			if status, body := s(context.Background(), unsignedCall(from)); status != http.StatusForbidden || codeOf(body) != "memberUnsigned" {
				t.Errorf("an unsigned call naming %q %s = %d %s, want 403 memberUnsigned", from, name, status, body)
			}
		}
	}
}

// TestACallMustNameTheIDItsKeyMakesForAnInstance refuses a key for any id but
// the one it makes for an instance, and refuses the clients of other apps on
// the same relay, so no key is pinned under another key's id or as a kind
// ArrowLoop has none of.
func TestACallMustNameTheIDItsKeyMakesForAnInstance(t *testing.T) {
	m, serve := guarded(t)
	for i, c := range []struct{ id, kind string }{
		{idOf(memberKeyOf(80), relay.KindMobile), relay.KindInstance},
		{idOf(memberKeyOf(81), relay.KindExtension), relay.KindInstance},
		{idOf(memberKeyOf(82), relay.KindInstance), relay.KindMobile},
		{idOf(memberKeyOf(83), relay.KindInstance), relay.KindExtension},
		{strings.ToUpper(idOf(memberKeyOf(84), relay.KindInstance)), relay.KindInstance},
		{idOf(memberKeyOf(88), relay.KindInstance), ""},
		{idOf(memberKeyOf(89), relay.KindInstance), "robot"},
		{nasID, relay.KindInstance},
	} {
		if status, body := serve(context.Background(), signedCall(memberKeyOf(byte(80+i)), c.id, c.kind)); status != http.StatusForbidden || codeOf(body) != "memberKind" {
			t.Errorf("%q signing as %q = %d %s, want 403 memberKind", c.id, c.kind, status, body)
		}
	}
	phone := memberKeyOf(90)
	if status, body := serve(context.Background(), callAs(phone, relay.KindMobile)); codeOf(body) != "memberKind" {
		t.Errorf("a client of another app under the id its key makes = %d %s, want 403 memberKind", status, body)
	}
	if pending := m.PendingMembers(); len(pending) != 0 {
		t.Errorf("pinned %+v for ids their keys do not make", pending)
	}
	if _, _, err := m.Approve(idOf(phone, relay.KindMobile), phone.Public().(ed25519.PublicKey), relay.KindInstance); err != ErrKindMismatch {
		t.Errorf("an approval passed on for an instance under a phone client's id = %v, want ErrKindMismatch", err)
	}
}

// TestRefusingAnInstanceWithoutAKeyDoesNotBanIt: an instance keeps its id when
// it leaves, so a refusal passed on for one this instance has no key of takes
// nothing away for good.
func TestRefusingAnInstanceWithoutAKeyDoesNotBanIt(t *testing.T) {
	m, serve := guarded(t)
	nas := memberKeyOf(93)
	if err := m.Refuse(idOf(nas, relay.KindInstance), time.Now()); err != nil {
		t.Fatal(err)
	}
	if status, body := serve(context.Background(), callAs(nas, relay.KindInstance)); codeOf(body) != "memberPending" {
		t.Errorf("the instance signing in afterwards = %d %s, want it waiting for approval", status, body)
	}
}

// TestAnInstanceEnteringTheWordsApprovesTheInstancesAlreadyThere: the
// instances an instance meets right after its owner entered the words of a
// group wait for approval there like any other, the real ones as well as one
// somebody holding the words announces at that moment.
func TestAnInstanceEnteringTheWordsApprovesTheInstancesAlreadyThere(t *testing.T) {
	m := newManager(t)
	joined := time.Now()
	if err := m.SetJoined(joined); err != nil {
		t.Fatal(err)
	}
	office, evil := memberKeyOf(40), memberKeyOf(41)
	officeID, evilID := idOf(office, relay.KindInstance), idOf(evil, relay.KindInstance)
	m.SetRelay(&fakeRelay{sibs: []relay.Announce{{InstanceID: officeID, Name: "office"}, {InstanceID: evilID, Name: "office"}}})
	for _, c := range []relay.ProxyCall{callAs(office, relay.KindInstance), callAs(evil, relay.KindInstance)} {
		caller, r := m.admit(c, "", joined.Add(time.Second))
		if r == nil || codeOf(r.body) != "memberPending" {
			t.Errorf("%s signing right after the words were entered = %+v, want it waiting for approval", c.From, r)
		}
		if m.ApprovedInstance(Caller{ID: c.From, Kind: relay.KindInstance, Key: c.Key}) || caller.ID != "" {
			t.Errorf("%s counts as an approved instance", c.From)
		}
	}
	if _, _, err := m.Approve(officeID, nil, ""); err != nil {
		t.Fatal(err)
	}
	if _, r := m.admit(callAs(office, relay.KindInstance), "", joined.Add(2*time.Second)); r != nil {
		t.Errorf("the office once its owner approved it here = %s, want it served", r.body)
	}
}

func TestADamagedGroupFileStopsTheStart(t *testing.T) {
	dir := t.TempDir()
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.SetJoined(time.Now()); err != nil {
		t.Fatal(err)
	}
	serve := m.Guard(func(context.Context, relay.ProxyCall) (int, []byte) { return http.StatusOK, nil })
	gone := memberKeyOf(95)
	letIn(t, m, serve, gone, relay.KindInstance)
	if err := m.RemoveMember(idOf(gone, relay.KindInstance), time.Now()); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "group.json")
	whole, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, whole[:len(whole)/2], 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(dir); err == nil {
		t.Fatal("a cut-off group.json loaded as a group with nobody taken out")
	}
	if err := os.WriteFile(path, whole, 0o600); err != nil {
		t.Fatal(err)
	}
	again, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	againServe := again.Guard(func(context.Context, relay.ProxyCall) (int, []byte) { return http.StatusOK, nil })
	if status, body := againServe(context.Background(), callAs(gone, relay.KindInstance)); status != http.StatusGone {
		t.Errorf("the key taken out, after a restart = %d %s, want 410", status, body)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".group.json.tmp-*")); len(left) != 0 {
		t.Errorf("writing the file left %v behind", left)
	}
}
