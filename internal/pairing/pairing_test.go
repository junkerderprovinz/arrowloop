package pairing

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var key = bytes.Repeat([]byte{7}, 32)

func TestASecretSurvivesARestartSealed(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, key)
	if err != nil {
		t.Fatal(err)
	}
	if st := s.Get(); st.Secret != nil || st.Mode() != ModeProject {
		t.Fatalf("a new install = %+v, want no group on the project relay", st)
	}
	secret := []byte("0123456789abcdef")
	seed := bytes.Repeat([]byte{9}, 32)
	if err := s.Update(func(st *State) error {
		st.Secret, st.Member, st.Name = secret, seed, "Cellar"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	for _, clear := range [][]byte{secret, []byte("30313233"), []byte("MDEyMzQ1")} {
		if bytes.Contains(raw, clear) {
			t.Fatalf("%s holds the secret in a form anybody reads: %s", FileName, raw)
		}
	}
	if info, err := os.Stat(filepath.Join(dir, FileName)); err == nil && info.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/' {
		t.Errorf("%s is readable by others: %v", FileName, info.Mode())
	}

	again, err := Open(dir, key)
	if err != nil {
		t.Fatal(err)
	}
	st := again.Get()
	if !bytes.Equal(st.Secret, secret) || !bytes.Equal(st.Member, seed) || st.Name != "Cellar" {
		t.Fatalf("after a restart = %+v, want the secret, the member key and the name back", st)
	}
}

func TestAnotherKeyDoesNotOpenTheFile(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Update(func(st *State) error { st.Secret = []byte("0123456789abcdef"); return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dir, bytes.Repeat([]byte{8}, 32)); err == nil || !strings.Contains(err.Error(), FileName) {
		t.Fatalf("opening under another key = %v, want an error naming the file", err)
	}
}

func TestAFailedUpdateChangesNothing(t *testing.T) {
	s, err := Open(t.TempDir(), key)
	if err != nil {
		t.Fatal(err)
	}
	boom := errors.New("no")
	if err := s.Update(func(st *State) error { st.Name = "half"; return boom }); !errors.Is(err, boom) {
		t.Fatalf("update = %v, want the refusal back", err)
	}
	if s.Get().Name != "" {
		t.Error("a refused update was kept")
	}
}

func TestTheRelayModeFollowsWhatWasChosen(t *testing.T) {
	for _, tc := range []struct {
		stored, want string
	}{
		{"", ModeProject},
		{ModeProject, ModeProject},
		{ModeOwn, ModeOwn},
		{ModeOff, ModeOff},
		{"elsewhere", ModeProject},
	} {
		if got := (State{RelayMode: tc.stored}).Mode(); got != tc.want {
			t.Errorf("Mode() of %q = %q, want %q", tc.stored, got, tc.want)
		}
	}
	if !ValidMode(ModeOwn) || ValidMode("elsewhere") || ValidMode("") {
		t.Error("ValidMode lets through a mode nobody can choose, or refuses one")
	}
}

func TestADamagedFileStopsTheStart(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, FileName), []byte(`{"secret":`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dir, key); err == nil {
		t.Fatal("a cut-off file opened as an install outside any group")
	}
}
