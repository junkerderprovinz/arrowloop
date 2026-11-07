package federation

import (
	"crypto/ed25519"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/relay"
)

func TestGroupKeepsTheFirstTimeAMemberCame(t *testing.T) {
	dir := t.TempDir()
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	joined := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	if err := m.SetJoined(joined); err != nil {
		t.Fatal(err)
	}

	st, err := m.Group(false, joined.Add(30*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if !st.JoinedAt.Equal(joined) || !st.MemberSeenAt.IsZero() {
		t.Fatalf("alone in the group: %+v", st)
	}

	came := joined.Add(2 * time.Minute)
	if st, err = m.Group(true, came); err != nil {
		t.Fatal(err)
	}
	if !st.MemberSeenAt.Equal(came) {
		t.Fatalf("MemberSeenAt = %v, want %v", st.MemberSeenAt, came)
	}
	if st, err = m.Group(false, came.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if !st.MemberSeenAt.Equal(came) {
		t.Fatalf("a member going away moved MemberSeenAt to %v", st.MemberSeenAt)
	}

	again, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st, _ := again.Group(false, came.Add(time.Hour)); !st.JoinedAt.Equal(joined) || !st.MemberSeenAt.Equal(came) {
		t.Fatalf("after a restart: %+v", st)
	}
}

func TestLeavingStartsTheNextGroupWithNobodySeen(t *testing.T) {
	m := newManager(t)
	joined := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	if err := m.SetJoined(joined); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Group(true, joined.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}

	if err := m.SetJoined(time.Time{}); err != nil {
		t.Fatal(err)
	}
	st, err := m.Group(true, joined.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if !st.JoinedAt.IsZero() || !st.MemberSeenAt.IsZero() {
		t.Fatalf("outside a group: %+v", st)
	}

	rejoined := joined.Add(3 * time.Minute)
	if err := m.SetJoined(rejoined); err != nil {
		t.Fatal(err)
	}
	if st, _ := m.Group(false, rejoined); !st.MemberSeenAt.IsZero() {
		t.Fatalf("a new group starts with a member seen: %+v", st)
	}
}

func TestAnApprovedInstanceThatClosedKeepsItsCardThroughARestart(t *testing.T) {
	dir := t.TempDir()
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	joined := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	if err := m.SetJoined(joined); err != nil {
		t.Fatal(err)
	}
	m.group.state.Keys = map[string]PinnedKey{
		laptopID: {Key: memberKeyOf(210).Public().(ed25519.PublicKey), Kind: relay.KindInstance, Approved: true, Used: joined},
	}
	rt := &fakeRelay{sibs: []relay.Announce{
		{InstanceID: laptopID, Name: "Laptop", Deployment: "desktop", Address: "http://192.168.20.86:8749"},
	}}
	m.SetRelay(rt)
	seen := joined.Add(time.Minute)
	if away, err := m.AwayMembers(seen); err != nil || len(away) != 0 {
		t.Fatalf("away while it is there = %+v, %v; want none", away, err)
	}

	rt.sibs = nil
	want := AwayMember{ID: laptopID, KnownMember: KnownMember{Name: "Laptop", Deployment: "desktop",
		Address: "http://192.168.20.86:8749", LastSeen: seen}}
	away, err := m.AwayMembers(seen.Add(time.Hour))
	if err != nil || len(away) != 1 || away[0] != want {
		t.Fatalf("away after it closed = %+v, %v; want %+v", away, err, want)
	}

	restarted, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if away, _ := restarted.AwayMembers(seen.Add(2 * time.Hour)); len(away) != 1 || !away[0].LastSeen.Equal(seen) {
		t.Fatalf("away after a restart = %+v, want the desktop app last seen %v", away, seen)
	}

	if err := restarted.RemoveMember(laptopID, seen.Add(3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if away, _ := restarted.AwayMembers(seen.Add(3 * time.Hour)); len(away) != 0 {
		t.Fatalf("away after it was taken out = %+v, want none", away)
	}
	if again, _ := Load(dir); len(again.group.state.Members) != 0 {
		t.Fatalf("the card of the instance taken out is still stored: %+v", again.group.state.Members)
	}
}

func TestAnInstanceNobodyApprovedLeavesNoCardBehind(t *testing.T) {
	m := newManager(t)
	joined := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	if err := m.SetJoined(joined); err != nil {
		t.Fatal(err)
	}
	m.group.state.Keys = map[string]PinnedKey{
		nasID: {Key: memberKeyOf(211).Public().(ed25519.PublicKey), Kind: relay.KindInstance, Used: joined},
	}
	rt := &fakeRelay{sibs: []relay.Announce{{InstanceID: nasID, Name: "stranger"}, {InstanceID: bravoID, Name: "unsigned"}}}
	m.SetRelay(rt)
	if _, err := m.AwayMembers(joined.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	rt.sibs = nil
	if away, _ := m.AwayMembers(joined.Add(time.Hour)); len(away) != 0 {
		t.Fatalf("away = %+v, want nobody, since nobody was approved", away)
	}
}

func TestAnAwayInstanceIsSeenWhenItsKeyLastSigned(t *testing.T) {
	m := newManager(t)
	joined := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	if err := m.SetJoined(joined); err != nil {
		t.Fatal(err)
	}
	key := memberKeyOf(212).Public().(ed25519.PublicKey)
	m.group.state.Keys = map[string]PinnedKey{laptopID: {Key: key, Kind: relay.KindInstance, Approved: true, Used: joined}}
	rt := &fakeRelay{sibs: []relay.Announce{{InstanceID: laptopID, Name: "Laptop", Deployment: "desktop"}}}
	m.SetRelay(rt)
	if _, err := m.AwayMembers(joined.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}

	rt.sibs = nil
	called := joined.Add(time.Hour)
	m.group.state.Keys[laptopID] = PinnedKey{Key: key, Kind: relay.KindInstance, Approved: true, Used: called}
	if away, _ := m.AwayMembers(called.Add(time.Hour)); len(away) != 1 || !away[0].LastSeen.Equal(called) {
		t.Fatalf("away = %+v, want the desktop app last seen %v", away, called)
	}
}
