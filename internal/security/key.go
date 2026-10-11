package security

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

	path := filepath.Join(filepath.Dir(configPath), KeyFileName)
	body, err := os.ReadFile(path)
	if err == nil {
		key, err := parseKey(strings.TrimSpace(string(body)))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		return key, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("draw a key: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("prepare %s: %w", filepath.Dir(path), err)
	}
	// O_EXCL, so two processes starting at once cannot each write their own.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		return LoadKey(configPath)
	}
	if err != nil {
		return nil, fmt.Errorf("write %s: %w", path, err)
	}
	_, werr := f.WriteString(hex.EncodeToString(key) + "\n")
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		os.Remove(path)
		return nil, fmt.Errorf("write %s: %w", path, werr)
	}
	return key, nil
}

func parseKey(raw string) ([]byte, error) {
	key, err := hex.DecodeString(raw)
	if err != nil || len(key) != 32 {
		return nil, errors.New("the key has to be 64 hexadecimal characters, as openssl rand -hex 32 prints")
	}
	return key, nil
}
