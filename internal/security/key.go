package security

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/gofrs/flock"
)

// KeyEnv names the environment variable an install's key can arrive through,
// as 64 hexadecimal characters. The key peppers the password hash, seals the
// second factor's secret and keys what is derived from both, so a copy of
// security.json alone opens nothing.
const KeyEnv = "ARROWLOOP_APP_KEY"

// KeyFileName is the file beside the configuration that holds the key when
// KeyEnv is not set. A copy of the whole configuration folder carries both,
// which is why setting KeyEnv outside it is the stronger choice.
const KeyFileName = "app.key"

// passwordHashEnv is web.PasswordHashEnv, which this package cannot import.
const passwordHashEnv = "ARROWLOOP_PASSWORD_HASH"

// keyedFiles hold what is sealed with the key or derived from it: the sign-in
// in both its files, the pairing with its older group.json, and the VPN logins.
var keyedFiles = []string{FileName, SignInFileName, "pairing.json", "group.json", "vpn.json"}

// errUnfinished is a key file that is empty or holds the start of a key,
// which is what a first start that died while writing it left behind.
var errUnfinished = errors.New("the key file was never finished")

// LoadKey returns the key from KeyEnv, or from the file beside the given
// configuration file, drawing and writing one on first use.
func LoadKey(configPath string) ([]byte, error) {
	if raw := strings.TrimSpace(os.Getenv(KeyEnv)); raw != "" {
		key, err := parseKey(raw)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", KeyEnv, err)
		}
		return key, nil
	}

	dir := filepath.Dir(configPath)
	path := filepath.Join(dir, KeyFileName)
	key, err := readKey(path)
	if !needsKey(err) {
		return key, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("prepare %s: %w", dir, err)
	}
	lock := flock.New(path + ".lock")
	if err := lock.Lock(); err != nil {
		return nil, fmt.Errorf("lock %s: %w", lock.Path(), err)
	}
	defer lock.Unlock()

	// Another start may have written the key while this one waited.
	key, err = readKey(path)
	if !needsKey(err) {
		return key, err
	}
	if errors.Is(err, errUnfinished) {
		if used := keyInUse(dir); used != "" {
			return nil, fmt.Errorf("%s holds no complete key, but %s was made with the one it should hold: put the key back or set %s to it", path, used, KeyEnv)
		}
	}
	key = make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("draw a key: %w", err)
	}
	if err := writeKey(path, key); err != nil {
		return nil, fmt.Errorf("write %s: %w", path, err)
	}
	return key, nil
}

func readKey(path string) ([]byte, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	raw := strings.TrimSpace(string(body))
	key, err := parseKey(raw)
	if err == nil {
		return key, nil
	}
	if len(raw) < 64 && strings.Trim(raw, "0123456789abcdef") == "" {
		return nil, fmt.Errorf("%s: %w", path, errUnfinished)
	}
	return nil, fmt.Errorf("%s: %w", path, err)
}

func needsKey(err error) bool {
	return errors.Is(err, fs.ErrNotExist) || errors.Is(err, errUnfinished)
}

// keyInUse names what depends on the key, if anything does. A key that never
// made it into its file was never handed out, so nothing can have been made
// with it, but an empty file on its own does not prove that it was never
// written: a power cut after an unsynced write leaves one too. A fresh key is
// safe only while nothing it would fail to open exists.
func keyInUse(dir string) string {
	if os.Getenv(passwordHashEnv) != "" {
		return passwordHashEnv
	}
	for _, name := range keyedFiles {
		if _, err := os.Lstat(filepath.Join(dir, name)); !errors.Is(err, fs.ErrNotExist) {
			return name
		}
	}
	return ""
}

// writeKey syncs the key in a file of its own and renames it into place, so
// no start ever reads part of a key and a power cut cannot empty the file.
// The rename replaces nothing another start wrote, since every start that
// writes holds the lock and has looked again first.
func writeKey(path string, key []byte) error {
	tmp := path + ".writing"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, err = f.WriteString(hex.EncodeToString(key) + "\n")
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	syncDir(filepath.Dir(path))
	return nil
}

// syncDir makes the rename itself survive a power cut. It is best effort:
// Windows cannot sync a folder, some network filesystems refuse to, and the
// key is already safe in its synced file either way.
func syncDir(dir string) {
	if runtime.GOOS == "windows" {
		return
	}
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
}

func parseKey(raw string) ([]byte, error) {
	key, err := hex.DecodeString(raw)
	if err != nil || len(key) != 32 {
		return nil, errors.New("the key has to be 64 hexadecimal characters, as openssl rand -hex 32 prints")
	}
	return key, nil
}
