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
	s, err := Open(filepath.Join(dir, "arrowloop.json"), testKey)
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
	_, err := Open(filepath.Join(dir, "arrowloop.json"), testKey)
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

// Two rows for one credential would make the clone check compare the counter
// against whichever row it met first.
// A reset or a change between the password check and the browser's answer
// removed every key, so the key that answer brings is refused too.
// A browser refuses a key whose host name does not match the page.
// Every registered key is bound to this id, so drawing a new one would strand
// them all.
// The second factor's secret is what a stolen file would need to make codes.
func TestTheSecondFactorIsSealedOnDisk(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "arrowloop.json")
	s, err := Open(config, testKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Update(func(st *State) error { st.TOTP.Secret = sampleSecret; return nil }); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), sampleSecret) || !strings.Contains(string(body), sealedPrefix) {
		t.Fatalf("the secret is in the file in clear:\n%s", body)
	}

	again, err := Open(config, testKey)
	if err != nil {
		t.Fatal(err)
	}
	if again.Get().TOTP.Secret != sampleSecret {
		t.Errorf("the secret came back as %q", again.Get().TOTP.Secret)
	}
	if _, err := Open(config, []byte("another key, thirty-two bytes..")); err == nil {
		t.Error("the file opened under another key")
	}
}

func TestASecretAnOlderBuildLeftInClearIsSealed(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, FileName)
	if err := os.WriteFile(path, []byte(`{"passwordHash":"x","totp":{"secret":"`+sampleSecret+`","enabled":true}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(filepath.Join(dir, "arrowloop.json"), testKey)
	if err != nil {
		t.Fatal(err)
	}
	if s.Get().TOTP.Secret != sampleSecret {
		t.Fatalf("the secret read as %q", s.Get().TOTP.Secret)
	}
	body, _ := os.ReadFile(path)
	if strings.Contains(string(body), sampleSecret) {
		t.Errorf("the secret is still in clear:\n%s", body)
	}
}

func TestAFileFromANewerBuildIsRefused(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, FileName), []byte(`{"version":99,"passwordHash":"x"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(filepath.Join(dir, "arrowloop.json"), testKey); err == nil || !strings.Contains(err.Error(), "newer") {
		t.Errorf("a file from a newer build gave %v", err)
	}
}

// testKey stands in for an install's key.
var testKey = []byte("0123456789abcdef0123456789abcdef")

// sampleSecret is the RFC 6238 test secret, nobody's real one.
const sampleSecret = "GEZDGNBVGY3TQOJQ" // gitleaks:allow
