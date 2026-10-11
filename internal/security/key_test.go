package security

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTheKeyIsDrawnOnceAndKept(t *testing.T) {
	t.Setenv(KeyEnv, "")
	config := filepath.Join(t.TempDir(), "arrowloop.json")
	first, err := LoadKey(config)
	if err != nil {
		t.Fatal(err)
	}
	again, err := LoadKey(config)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 32 || !bytes.Equal(first, again) {
		t.Fatalf("the key changed between two starts: %x, %x", first, again)
	}
	info, err := os.Stat(filepath.Join(filepath.Dir(config), KeyFileName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/' {
		t.Errorf("the key file is open to others: %v", info.Mode().Perm())
	}
}

func TestTheKeyFromTheEnvironmentWins(t *testing.T) {
	t.Setenv(KeyEnv, strings.Repeat("ab", 32))
	key, err := LoadKey(filepath.Join(t.TempDir(), "arrowloop.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(key, bytes.Repeat([]byte{0xab}, 32)) {
		t.Errorf("got %x", key)
	}

	t.Setenv(KeyEnv, "too short")
	if _, err := LoadKey(filepath.Join(t.TempDir(), "arrowloop.json")); err == nil {
		t.Error("a key that is not 64 hex characters was taken")
	}
}
