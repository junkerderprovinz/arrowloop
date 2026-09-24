package security

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func openIn(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := Open(filepath.Join(dir, "arrowloop.json"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return s
}

// A new install has no file, and that has to mean no password rather than an
// error that keeps the program from starting.
func TestAMissingFileIsAnEmptyState(t *testing.T) {
	s := openIn(t, t.TempDir())
	if st := s.Get(); st.PasswordHash != "" || st.TOTP.Enabled || len(st.Passkeys) != 0 {
		t.Fatalf("a missing file gave %+v", st)
	}
}

func TestWhatIsWrittenIsReadBack(t *testing.T) {
	dir := t.TempDir()
	s := openIn(t, dir)
	err := s.Update(func(st *State) error {
		st.PasswordHash = "$2a$10$example"
		st.TOTP = TOTP{Secret: rfcSecret, Enabled: true, Recovery: []string{"a", "b"}, LastStep: 7}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	again := openIn(t, dir).Get()
	if again.PasswordHash != "$2a$10$example" || !again.TOTP.Enabled || again.TOTP.LastStep != 7 || len(again.TOTP.Recovery) != 2 {
		t.Fatalf("the file came back changed: %+v", again)
	}
	if filepath.Base(s.Path()) != FileName || filepath.Dir(s.Path()) != dir {
		t.Errorf("the file is at %s, not beside the configuration", s.Path())
	}
}

// Treating a damaged file as empty would switch the password off.
func TestADamagedFileIsRefusedRatherThanIgnored(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, FileName), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := Open(filepath.Join(dir, "arrowloop.json"))
	if err == nil {
		t.Fatal("a damaged security file was read as an install without a password")
	}
	if !strings.Contains(err.Error(), "delete it") {
		t.Errorf("the error does not say how to get going again: %v", err)
	}
}

func TestAFailedUpdateChangesNothing(t *testing.T) {
	dir := t.TempDir()
	s := openIn(t, dir)
	if err := s.Update(func(st *State) error { st.PasswordHash = "kept"; return nil }); err != nil {
		t.Fatal(err)
	}
	refused := errors.New("refused")
	err := s.Update(func(st *State) error {
		st.PasswordHash = "lost"
		return refused
	})
	if !errors.Is(err, refused) {
		t.Fatalf("Update returned %v, want the callback's error", err)
	}
	if got := s.Get().PasswordHash; got != "kept" {
		t.Errorf("the refused change reached memory: %q", got)
	}
	if got := openIn(t, dir).Get().PasswordHash; got != "kept" {
		t.Errorf("the refused change reached the file: %q", got)
	}
}

func TestTheFileIsReadableByItsOwnerOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has no mode bits to check")
	}
	s := openIn(t, t.TempDir())
	if err := s.Update(func(st *State) error { st.PasswordHash = "x"; return nil }); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("security.json has mode %o, want 600", mode)
	}
}

// A caller that edits what Get returned must not edit the store.
func TestGetHandsOutACopy(t *testing.T) {
	s := openIn(t, t.TempDir())
	if err := s.Update(func(st *State) error { st.TOTP.Recovery = []string{"a"}; return nil }); err != nil {
		t.Fatal(err)
	}
	got := s.Get()
	got.TOTP.Recovery[0] = "changed"
	if s.Get().TOTP.Recovery[0] != "a" {
		t.Error("changing a returned state changed the store")
	}
}

func TestPasskeyRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := openIn(t, dir)

	saved, err := s.AddPasskey(Passkey{
		Name:         "Phone",
		CredentialID: []byte{1, 2, 3},
		PublicKey:    []byte{9, 9},
		Transports:   "internal,hybrid",
		RPID:         "arrowloop.example.com",
		BackedUp:     true,
		CreatedAt:    1700000000,
	})
	if err != nil {
		t.Fatalf("AddPasskey: %v", err)
	}
	if saved.ID == "" {
		t.Fatal("the saved key carries no id")
	}

	if err := s.TouchPasskey(saved.ID, 42, 1700000100); err != nil {
		t.Fatal(err)
	}
	got := openIn(t, dir).Get().Passkeys
	if len(got) != 1 || got[0].SignCount != 42 || got[0].LastUsedAt != 1700000100 || got[0].Name != "Phone" {
		t.Fatalf("the key came back changed: %+v", got)
	}

	if err := s.DeletePasskey(saved.ID); err != nil {
		t.Fatal(err)
	}
	if n := len(s.Get().Passkeys); n != 0 {
		t.Errorf("%d keys left after the delete", n)
	}
	if err := s.DeletePasskey(saved.ID); err != nil {
		t.Errorf("deleting an absent key: %v", err)
	}
}

// Two rows for one credential would make the clone check compare the counter
// against whichever row it met first.
func TestTheSameCredentialIsRegisteredOnce(t *testing.T) {
	s := openIn(t, t.TempDir())
	p := Passkey{Name: "A", CredentialID: []byte{5}, PublicKey: []byte{1}, RPID: "a.example.com"}
	if _, err := s.AddPasskey(p); err != nil {
		t.Fatal(err)
	}
	p.Name = "B"
	if _, err := s.AddPasskey(p); !errors.Is(err, ErrPasskeyExists) {
		t.Errorf("the second registration gave %v, want ErrPasskeyExists", err)
	}
}

// A browser refuses a key whose host name does not match the page.
func TestPasskeysForFiltersByAddress(t *testing.T) {
	s := openIn(t, t.TempDir())
	for i, rp := range []string{"al.example.com", "localhost"} {
		if _, err := s.AddPasskey(Passkey{Name: rp, CredentialID: []byte{byte(i + 1)}, PublicKey: []byte{1}, RPID: rp}); err != nil {
			t.Fatal(err)
		}
	}
	here := s.Get().PasskeysFor("al.example.com")
	if len(here) != 1 || here[0].Name != "al.example.com" {
		t.Errorf("PasskeysFor returned %v, want only the key bound to that address", here)
	}
	if n := len(s.Get().Passkeys); n != 2 {
		t.Errorf("the full list has %d keys, want both", n)
	}
}

// Every registered key is bound to this id, so drawing a new one would strand
// them all.
func TestThePasskeyAccountStaysTheSame(t *testing.T) {
	dir := t.TempDir()
	first, err := openIn(t, dir).PasskeyUser()
	if err != nil {
		t.Fatal(err)
	}
	if len(first) < 16 {
		t.Fatalf("the account id is %d bytes", len(first))
	}
	again, err := openIn(t, dir).PasskeyUser()
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(again) {
		t.Error("the passkey account id changed between two opens")
	}
}
