package remotes

import (
	"context"
	"fmt"
	"sort"
	"strings"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/obscure"
)

// WithSavedSecrets fills in the saved credentials a form left empty or at the
// placeholder, since secrets are withheld on their way to the screen. It reads
// the form the way Save does, and anything typed wins, so a changed credential
// is the one tested. The stored value comes back obscured as rclone keeps it,
// and connectionString leaves an obscured value alone.
func WithSavedSecrets(name string, settings map[string]string) map[string]string {
	if strings.TrimSpace(name) == "" {
		return settings
	}
	data := config.LoadedData()
	if !data.HasSection(name) {
		return settings
	}

	// The caller's map came off a request body.
	out := make(map[string]string, len(settings)+2)
	for key, value := range settings {
		out[key] = value
	}
	for _, key := range data.GetKeyList(name) {
		if key == "type" || !IsSecret(key) {
			continue
		}
		if given, ok := out[key]; ok && given != "" && given != Placeholder {
			continue
		}
		if stored, ok := data.GetValue(name, key); ok && stored != "" {
			out[key] = stored
		}
	}
	return out
}

// CheckSettings reports whether a target built from settings that have not
// been saved answers. It goes through an inline connection string, so no
// temporary remote holding real credentials is ever written.
func CheckSettings(ctx context.Context, backend string, settings map[string]string) error {
	if backend == "" {
		return fmt.Errorf("a remote needs a type, for example s3 or sftp")
	}
	if _, err := rclonefs.Find(backend); err != nil {
		return fmt.Errorf("this build does not include the %q backend: %w", backend, err)
	}

	ctx, stop := context.WithTimeout(ctx, CheckWait)
	defer stop()

	f, err := rclonefs.NewFs(ctx, connectionString(backend, settings))
	if err != nil {
		return checkErr(ctx, err)
	}
	if _, err := f.List(ctx, ""); err != nil && !isEmptyTarget(err) {
		return checkErr(ctx, err)
	}
	return nil
}

// connectionString renders settings as rclone's inline-remote syntax,
// :backend,k=v,k=v:, with the keys sorted.
func connectionString(backend string, settings map[string]string) string {
	keys := make([]string, 0, len(settings))
	for key := range settings {
		if key == "type" || settings[key] == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString(":")
	b.WriteString(backend)
	for _, key := range keys {
		b.WriteString(",")
		b.WriteString(key)
		b.WriteString("=")
		b.WriteString(quoteValue(forConnection(backend, key, settings[key])))
	}
	b.WriteString(":")
	return b.String()
}

// forConnection obscures what rclone will reveal: it reads a connection string
// the same way it reads the config file, so the rule in needsObscure applies.
// A value that is already obscured, such as a saved secret, is left alone.
func forConnection(backend, key, value string) string {
	if value == "" || !needsObscure(backend, key) {
		return value
	}
	if _, err := obscure.Reveal(value); err == nil {
		return value
	}
	hidden, err := obscure.Obscure(value)
	if err != nil {
		return value
	}
	return hidden
}

// quoteValue wraps a value in double quotes, doubling any inside, unless every
// character is safe bare. It uses an allow-list because the separators include
// the colon, which every URL contains.
func quoteValue(value string) string {
	if value != "" && strings.IndexFunc(value, needsQuoting) < 0 {
		return value
	}
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

// needsQuoting is true for anything outside the set that is safe bare: letters,
// digits, and the four punctuation marks no part of the syntax uses.
func needsQuoting(r rune) bool {
	switch {
	case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		return false
	case r == '-', r == '_', r == '.', r == '~':
		return false
	}
	return true
}
