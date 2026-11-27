package security

import (
	"bytes"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"sync"
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

func TestAKeyFileAStartLeftUnfinishedIsCompletedByTheNext(t *testing.T) {
	for name, body := range map[string]string{"empty": "", "cut short": "3f9a0c71"} {
		t.Run(name, func(t *testing.T) {
			t.Setenv(KeyEnv, "")
			t.Setenv(passwordHashEnv, "")
			dir := t.TempDir()
			config := filepath.Join(dir, "arrowloop.json")
			if err := os.WriteFile(filepath.Join(dir, KeyFileName), []byte(body), 0o600); err != nil {
				t.Fatal(err)
			}
			key, err := LoadKey(config)
			if err != nil {
				t.Fatal(err)
			}
			again, err := LoadKey(config)
			if err != nil {
				t.Fatal(err)
			}
			if len(key) != 32 || !bytes.Equal(key, again) {
				t.Fatalf("the key changed between two starts: %x, %x", key, again)
			}
		})
	}
}

func TestAnUnfinishedKeyFileStaysWhenSomethingDependsOnTheKey(t *testing.T) {
	check := func(t *testing.T, dir string) {
		t.Helper()
		path := filepath.Join(dir, KeyFileName)
		if _, err := LoadKey(filepath.Join(dir, "arrowloop.json")); err == nil {
			t.Error("a fresh key was drawn although something was made with the lost one")
		}
		if body, err := os.ReadFile(path); err != nil || len(body) != 0 {
			t.Errorf("the key file was touched: %q, %v", body, err)
		}
	}
	for _, name := range []string{"security.json", "signin.json", "pairing.json", "group.json", "vpn.json"} {
		t.Run(name, func(t *testing.T) {
			t.Setenv(KeyEnv, "")
			t.Setenv(passwordHashEnv, "")
			dir := t.TempDir()
			for file, body := range map[string]string{KeyFileName: "", name: "{}\n"} {
				if err := os.WriteFile(filepath.Join(dir, file), []byte(body), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			check(t, dir)
		})
	}
	t.Run("password hash in the environment", func(t *testing.T) {
		t.Setenv(KeyEnv, "")
		t.Setenv(passwordHashEnv, "$argon2id$v=19$m=65536,t=3,p=2$c2FsdA$aGFzaA")
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, KeyFileName), nil, 0o600); err != nil {
			t.Fatal(err)
		}
		check(t, dir)
	})
}

func TestAKeyFileWithSomethingElseInItIsAnError(t *testing.T) {
	t.Setenv(KeyEnv, "")
	dir := t.TempDir()
	path := filepath.Join(dir, KeyFileName)
	if err := os.WriteFile(path, []byte("not a key at all\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadKey(filepath.Join(dir, "arrowloop.json")); err == nil {
		t.Error("a file that holds no key was taken")
	}
	if body, _ := os.ReadFile(path); string(body) != "not a key at all\n" {
		t.Errorf("the file was replaced: %q", body)
	}
}

func TestStartsAtOnceAllGetTheKeyThatIsKept(t *testing.T) {
	t.Setenv(KeyEnv, "")
	for range 50 {
		dir := t.TempDir()
		config := filepath.Join(dir, "arrowloop.json")
		const starts = 8
		keys := make([][]byte, starts)
		errs := make([]error, starts)
		gate := make(chan struct{})
		var wg sync.WaitGroup
		for i := range starts {
			wg.Go(func() {
				<-gate
				keys[i], errs[i] = LoadKey(config)
			})
		}
		close(gate)
		wg.Wait()
		kept, err := os.ReadFile(filepath.Join(dir, KeyFileName))
		if err != nil {
			t.Fatal(err)
		}
		for i := range starts {
			if errs[i] != nil {
				t.Fatalf("start %d: %v", i, errs[i])
			}
			if hex.EncodeToString(keys[i]) != strings.TrimSpace(string(kept)) {
				t.Fatalf("start %d got %x, the file keeps %s", i, keys[i], kept)
			}
		}
	}
}

func TestTheKeyFileNeverShowsPartOfAKey(t *testing.T) {
	t.Setenv(KeyEnv, "")
	for range 200 {
		dir := t.TempDir()
		path := filepath.Join(dir, KeyFileName)
		seen := make(chan string, 1)
		go func() {
			for {
				body, err := os.ReadFile(path)
				if err == nil {
					seen <- string(body)
					return
				}
			}
		}()
		if _, err := LoadKey(filepath.Join(dir, "arrowloop.json")); err != nil {
			t.Fatal(err)
		}
		if body := <-seen; len(strings.TrimSpace(body)) != 64 {
			t.Fatalf("a start reading at the wrong moment found %q", body)
		}
	}
}
