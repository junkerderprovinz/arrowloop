package pairing

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/group"
	"github.com/junkerderprovinz/parleyport/kit/member"
)

// The files in testdata/before-kit were written by ArrowLoop 2.6 for a group
// of three: alpha and bravo approved each other and charlie, then alpha took
// charlie out again. The install key of both is fixtureKey.
var fixtureKey = bytes.Repeat([]byte{3}, 32)

const (
	alphaID   = "12e7cf0d336525543ea55ea210bc1ad5d842d5fa"
	bravoID   = "02dc84d3555672c6cbc73e25695a177c6461f8b8"
	charlieID = "de7cea30eda17ddf6526a1491f268fc41d35483c"
)

// installFrom copies one instance's files from testdata/before-kit into a
// folder of its own.
func installFrom(t *testing.T, name string) string {
	t.Helper()
	dir := t.TempDir()
	for _, f := range []string{FileName, legacyGroupFile} {
		raw, err := os.ReadFile(filepath.Join("testdata", "before-kit", name, f))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, f), raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// openGroup opens the kit's group on what s keeps, with no relay and no
// network, as far as a test of the stored state needs one.
func openGroup(t *testing.T, s *Store) (*group.Group, member.Identity) {
	t.Helper()
	st := s.Get()
	id, err := member.FromSeed(member.KindInstance, st.Member)
	if err != nil {
		t.Fatal(err)
	}
	g, err := group.Open(group.Config{Domain: Domain, Secret: st.Secret, Identity: id, Relay: group.RelayOff, Store: s.GroupStore()}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = g.Close() })
	return g, id
}

func TestAGroupFromBeforeTheKitKeepsItsMembers(t *testing.T) {
	dir := installFrom(t, "alpha")
	s, err := Open(dir, fixtureKey)
	if err != nil {
		t.Fatal(err)
	}
	g, id := openGroup(t, s)
	if id.ID() != alphaID {
		t.Fatalf("the instance goes by %s after the update, want %s as before", id.ID(), alphaID)
	}

	members := g.Members()
	if len(members) != 1 {
		t.Fatalf("members = %+v, want bravo alone", members)
	}
	bravo := members[0]
	if bravo.ID != bravoID || bravo.State != group.StateApproved || bravo.Name != "bravo" || bravo.Deployment != "server" ||
		bravo.Kind != member.KindInstance || member.ID(member.KindInstance, bravo.Key) != bravoID || bravo.LastSeen.IsZero() {
		t.Errorf("bravo = %+v, want it approved under its own key with its name and when it was last there", bravo)
	}
	if err := g.Approve(charlieID); !errors.Is(err, group.ErrRemoved) {
		t.Errorf("approving charlie = %v, want it to stay taken out", err)
	}

	st := s.Get()
	if want := time.Date(2026, 11, 10, 0, 39, 56, 963480600, time.FixedZone("", 3600)); !st.JoinedAt.Equal(want) || st.MemberSeenAt.IsZero() {
		t.Errorf("joined %v, first member seen %v, want both kept from before", st.JoinedAt, st.MemberSeenAt)
	}
	if st.Name != "alpha" || st.Mode() != ModeOwn {
		t.Errorf("state = %+v, want the name and the relay kept", st)
	}
}

func TestTheMigratedGroupSurvivesARestart(t *testing.T) {
	dir := installFrom(t, "bravo")
	if _, err := Open(dir, fixtureKey); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, legacyGroupFile)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("%s is still where it was, so leaving and joining again would bring its members back: %v", legacyGroupFile, err)
	}
	if _, err := os.Stat(filepath.Join(dir, legacyGroupFile+".bak")); err != nil {
		t.Errorf("the file from before is not kept beside: %v", err)
	}

	again, err := Open(dir, fixtureKey)
	if err != nil {
		t.Fatal(err)
	}
	g, _ := openGroup(t, again)
	if members := g.Members(); len(members) != 1 || members[0].ID != alphaID || members[0].State != group.StateApproved {
		t.Errorf("members after a restart = %+v, want alpha approved", members)
	}
}

func TestAGroupFileWithoutAPhraseIsSetAside(t *testing.T) {
	dir := installFrom(t, "alpha")
	s, err := Open(dir, fixtureKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Update(func(st *State) error { st.Secret, st.Member = nil, nil; return nil }); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join("testdata", "before-kit", "alpha", legacyGroupFile))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, legacyGroupFile), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	s, err = Open(dir, fixtureKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Update(func(st *State) error { st.Secret, st.Member = bytes.Repeat([]byte{1}, 16), bytes.Repeat([]byte{2}, 32); return nil }); err != nil {
		t.Fatal(err)
	}
	g, _ := openGroup(t, s)
	if members := g.Members(); len(members) != 0 {
		t.Errorf("a group joined after leaving lists %+v, want nobody from the group left", members)
	}
}

func TestADamagedGroupFileFromBeforeStopsTheStart(t *testing.T) {
	dir := installFrom(t, "alpha")
	if err := os.WriteFile(filepath.Join(dir, legacyGroupFile), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dir, fixtureKey); err == nil {
		t.Fatal("Open started with a group file it could not read, which forgets every removal")
	}
}
