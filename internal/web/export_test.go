package web

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/signin"

	"github.com/junkerderprovinz/arrowloop/internal/pairing"
	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// ShortenMoveWait hands the fortress phrase to the instances that were away
// every d instead of every minute.
func ShortenMoveWait(t testing.TB, d time.Duration) {
	was := moveWait
	moveWait = d
	t.Cleanup(func() { moveWait = was })
}

// SettleJoinsWithin has a join through the relay conclude after d that
// nobody is there to turn it away. The test's relay lists the members at
// once, where a real one gets a second and a half.
func SettleJoinsWithin(d time.Duration) { joinSettle = d }

// ShortenTrashWait lets a test reach the deadline on a side's trash listing
// without waiting the full minute.
func ShortenTrashWait(t testing.TB, d time.Duration) {
	was := trashWait
	trashWait = d
	t.Cleanup(func() { trashWait = was })
}

// InFortress reports whether s has its fortress open.
func (s *Server) InFortress() bool { return s.fortressNow() != nil }

// BackdateMove restarts the pairing as if its move into the fortress had
// started ago before now.
func (s *Server) BackdateMove(t testing.TB, ago time.Duration) {
	t.Helper()
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	s.closeGroupLocked()
	store := s.Pairing.MoveStore()
	raw, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc["retired"], err = json.Marshal(time.Now().Add(-ago)); err != nil {
		t.Fatal(err)
	}
	if raw, err = json.Marshal(doc); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(raw); err != nil {
		t.Fatal(err)
	}
	s.openGroupLocked()
}

// BackdatePhraseChange opens the fortress again as if its phrase had changed
// ago before now.
func (s *Server) BackdatePhraseChange(t testing.TB, ago time.Duration) {
	t.Helper()
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	s.closeGroupLocked()
	if err := s.Pairing.Update(func(st *pairing.State) error {
		st.FortressChanged = time.Now().Add(-ago)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	s.openGroupLocked()
}

// OpensWithSignIn reports whether the fortress would open s's interface now,
// and whether it asks for a sign-in there.
func (s *Server) OpensWithSignIn() (offered, signIn bool) {
	ui := s.fortressUI()
	return ui != nil, ui != nil && !s.open()
}

// OpenSignIn opens the sign-in in dir as the web command does, with the hash
// from PasswordHashEnv, after password was set in the interface of the
// version before when it is not empty.
func OpenSignIn(t testing.TB, dir string, key []byte, password string) *signin.Auth {
	t.Helper()
	config := filepath.Join(dir, "arrowloop.json")
	if password != "" {
		old, err := security.Open(config, key)
		if err != nil {
			t.Fatal(err)
		}
		hash, err := security.HashPassword(key, password)
		if err != nil {
			t.Fatal(err)
		}
		if err := old.Update(func(st *security.State) error { st.PasswordHash = hash; return nil }); err != nil {
			t.Fatal(err)
		}
	}
	auth, err := security.OpenSignIn(security.SignIn{ConfigPath: config, Key: key, PasswordHash: os.Getenv(PasswordHashEnv)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = auth.Close() })
	return auth
}

// MemberViews is what GET /api/fortress lists of members.
var MemberViews = memberViews

// LeftOnOldPhrase is what a phrase change lists as left on the old phrase.
var LeftOnOldPhrase = leftOnOldPhrase

// PassChangeAgain hands the fortress's current phrase change once more to
// every instance of the pairing in reach, as a change does when the kit's
// hand-over got no answer, and returns the ids that took it.
func (s *Server) PassChangeAgain(ctx context.Context) []string {
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	paired := s.fortressNow().Pairing()
	return s.passChange(ctx, paired, online(paired.Members(), nil), s.Pairing.Get())
}
