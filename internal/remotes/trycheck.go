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
// is the one tested. A stored password comes back revealed, as if typed, since
// connectionString obscures every password. Nothing is filled in unless the
// backend and every setting apart from the secrets match the saved target, so
// a saved password never travels to a server the form names instead.
func WithSavedSecrets(name, backend string, settings map[string]string) map[string]string {
	if strings.TrimSpace(name) == "" {
		return settings
	}
	data := config.LoadedData()
	if !data.HasSection(name) {
		return settings
	}
	if stored, _ := data.GetValue(name, "type"); stored != backend {
		return settings
	}
	if !sameTarget(data, name, backend, settings) {
		return settings
	}

	// The caller's map came off a request body.
	out := make(map[string]string, len(settings)+2)
	for key, value := range settings {
		out[key] = value
	}
	for _, key := range data.GetKeyList(name) {
		if key == "type" || !IsSecret(backend, key) {
			continue
		}
		if given, ok := out[key]; ok && given != "" && given != Placeholder {
			continue
		}
		if stored, ok := data.GetValue(name, key); ok && stored != "" {
			out[key] = typedForm(backend, key, stored)
		}
	}
	return out
}

// sameTarget reports whether a form holds the saved target's settings, secrets
// aside, with nothing added or left out. Far more than the address decides
// where a connection goes: an SFTP socks_proxy, a known_hosts_file of none, a
// backend's own api_url. An empty value counts as no value, as Save stores it.
func sameTarget(data config.Storage, name, backend string, settings map[string]string) bool {
	keys := data.GetKeyList(name)
	for key := range settings {
		keys = append(keys, key)
	}
	for _, key := range keys {
		if key == "type" || (IsSecret(backend, key) && !addressKeys[key]) {
			continue
		}
		if stored, _ := data.GetValue(name, key); settings[key] != stored {
			return false
		}
	}
	return true
}

// addressKeys are the settings, across the backends, that decide which server
// a connection reaches and as whom. They are compared even where a backend
// counts one as secret.
var addressKeys = map[string]bool{
	"host": true, "port": true, "user": true, "url": true, "endpoint": true,
	"auth": true, "auth_url": true, "token_url": true,
}

// typedForm undoes what Save did to a value. One rclone cannot reveal is passed
// on as stored.
func typedForm(backend, key, stored string) string {
	if !needsObscure(backend, key) {
		return stored
	}
	if plain, err := obscure.Reveal(stored); err == nil {
		return plain
	}
	return stored
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
	return listRoot(ctx, f, backend)
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
// Every value is taken as typed, because a plain password can decode as
// readily as an obscured one.
func forConnection(backend, key, value string) string {
	if value == "" || !needsObscure(backend, key) {
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
