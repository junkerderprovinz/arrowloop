package pairing

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func paired(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := Open(dir, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Update(func(st *State) error {
		st.Secret, st.Member, st.Name = []byte("the app's phrase"), bytes.Repeat([]byte{9}, 32), "Cellar"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.GroupStore().Save([]byte(`{"members":"who was approved"}`)); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestEnteringAFortressKeepsTheGroupToMoveIt(t *testing.T) {
	dir := t.TempDir()
	s := paired(t, dir)
	fortress := []byte("fortress phrase!")
	if err := s.EnterFortress(fortress); err != nil {
		t.Fatal(err)
	}

	for _, s := range []*Store{s, reopened(t, dir)} {
		st := s.Get()
		if !st.Fortress || !bytes.Equal(st.Secret, fortress) || !bytes.Equal(st.PairingPrevious, []byte("the app's phrase")) ||
			!bytes.Equal(st.MoveFrom, []byte("the app's phrase")) || !bytes.Equal(st.Member, bytes.Repeat([]byte{9}, 32)) || st.Name != "Cellar" {
			t.Errorf("after entering the fortress the state is %+v", st)
		}
		for name, store := range map[string]interface{ Load() ([]byte, error) }{"pairing": s.GroupStore(), "mover": s.MoveStore()} {
			if got, _ := store.Load(); string(got) != `{"members":"who was approved"}` {
				t.Errorf("the %s holds %q, want the group from before", name, got)
			}
		}
		if got, _ := s.FortressStore().Load(); len(got) != 0 {
			t.Errorf("a new member's fortress holds %q", got)
		}
	}
}

func TestANewFortressPhraseKeepsTheOldOneAsPrevious(t *testing.T) {
	dir := t.TempDir()
	s := paired(t, dir)
	if err := s.EnterFortress([]byte("fortress phrase!")); err != nil {
		t.Fatal(err)
	}
	if err := s.FortressStore().Save([]byte(`{"fortress":"members"}`)); err != nil {
		t.Fatal(err)
	}
	before := time.Now()
	if err := s.ChangeFortressSecret([]byte("another phrase!!")); err != nil {
		t.Fatal(err)
	}
	st := reopened(t, dir).Get()
	if !bytes.Equal(st.Secret, []byte("another phrase!!")) || !bytes.Equal(st.FortressPrevious, []byte("fortress phrase!")) ||
		!bytes.Equal(st.PairingPrevious, []byte("fortress phrase!")) || !st.Fortress || st.FortressChanged.Before(before.Truncate(time.Second)) {
		t.Errorf("after a new phrase the state is %+v", st)
	}
	if got, _ := reopened(t, dir).FortressStore().Load(); string(got) != `{"fortress":"members"}` {
		t.Errorf("the fortress holds %q after a new phrase", got)
	}
}

func TestForgettingTheFortressPhraseBeforeKeepsTheNewOne(t *testing.T) {
	dir := t.TempDir()
	s := paired(t, dir)
	if err := s.EnterFortress([]byte("fortress phrase!")); err != nil {
		t.Fatal(err)
	}
	if err := s.ChangeFortressSecret([]byte("another phrase!!")); err != nil {
		t.Fatal(err)
	}
	if err := s.ForgetFortressPrevious(); err != nil {
		t.Fatal(err)
	}
	st := reopened(t, dir).Get()
	if !bytes.Equal(st.Secret, []byte("another phrase!!")) || st.FortressPrevious != nil || st.PairingPrevious != nil ||
		!st.FortressChanged.IsZero() || !bytes.Equal(st.MoveFrom, []byte("the app's phrase")) || !st.Fortress {
		t.Errorf("after forgetting the phrase before the state is %+v", st)
	}
	raw, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(`"fortressPrevious"`)) || bytes.Contains(raw, []byte(`"pairingPrevious"`)) {
		t.Errorf("%s keeps the phrase before: %s", FileName, raw)
	}
}

func TestAMoveThatIsDoneForgetsTheOldPhrase(t *testing.T) {
	dir := t.TempDir()
	s := paired(t, dir)
	if err := s.EnterFortress([]byte("fortress phrase!")); err != nil {
		t.Fatal(err)
	}
	if err := s.MoveDone(); err != nil {
		t.Fatal(err)
	}
	r := reopened(t, dir)
	if st := r.Get(); st.MoveFrom != nil || !st.Fortress {
		t.Errorf("after the move the state is %+v", st)
	}
	if got, _ := r.MoveStore().Load(); len(got) != 0 {
		t.Errorf("the mover still holds %q", got)
	}
	raw, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("fortress phrase")) || bytes.Contains(raw, []byte("who was approved")) {
		t.Errorf("%s holds something in the clear: %s", FileName, raw)
	}
}

func TestLeavingTheFortressForgetsItAll(t *testing.T) {
	dir := t.TempDir()
	s := paired(t, dir)
	if err := s.EnterFortress([]byte("fortress phrase!")); err != nil {
		t.Fatal(err)
	}
	if err := s.Update(func(st *State) error { st.Secret, st.Member, st.Fortress = nil, nil, false; return nil }); err != nil {
		t.Fatal(err)
	}
	st := reopened(t, dir).Get()
	if st.Fortress || st.Secret != nil || st.MoveFrom != nil || st.PairingPrevious != nil {
		t.Errorf("after leaving the state is %+v", st)
	}
	for _, store := range []interface{ Load() ([]byte, error) }{s.GroupStore(), s.FortressStore(), s.MoveStore()} {
		if got, _ := store.Load(); len(got) != 0 {
			t.Errorf("a store still holds %q after leaving", got)
		}
	}
}

func reopened(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := Open(dir, key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
