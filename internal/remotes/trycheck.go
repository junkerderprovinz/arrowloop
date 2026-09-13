package remotes

import (
	"context"
	"fmt"
	"sort"
	"strings"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/obscure"
)

// Checking settings that have not been saved yet.
//
// jdp: "der pruefen button der ziele soll in ziele einrichten seite nicht auf
// die card, dann kann man direkt pruefen bevor man auf speichern tippt."
//
// The existing Check reads a target out of rclone's configuration file, which is
// exactly wrong for a form: the whole point is to find out whether what somebody
// just typed works BEFORE it becomes a saved target. The obvious shortcut is to
// save under a temporary name, check, and delete - and it is a bad one, because
// a crash between the save and the delete leaves a half-named target behind
// holding real credentials, and two people editing at once would collide on the
// temporary name.
//
// rclone already has the right door: a CONNECTION STRING, `:backend,k=v,k=v:`,
// which builds a filesystem from settings given inline and touches no config
// file at all. Nothing is written, so nothing has to be cleaned up.

// CheckSettings reports whether a target built from these settings answers.
//
// The deadline is Check's, for the same reason: a form that waits forever on an
// address nobody answers has told the person nothing.
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

// connectionString renders settings as rclone's own inline-remote syntax.
//
// Sorted, so the same settings always produce the same string - which matters
// only for reading a log, and is free.
//
// A value carrying a comma, a quote or a space would otherwise end the option or
// the whole string early, so those are quoted rclone's way: wrap in double
// quotes and double any quote inside. A secret is exactly the kind of value that
// contains such a character, and getting this wrong would look like a wrong
// password rather than like a parsing bug.
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

// forConnection obscures what rclone will try to REVEAL.
//
// rclone reveals a backend's IsPassword options wherever it reads them, and it
// reads a connection string the same way it reads the config file. So the split
// obscuring.go already draws applies here unchanged: WebDAV's `pass` is
// obscured, S3's `secret_access_key` is not.
//
// Measured rather than reasoned: the first version passed everything verbatim
// and the live engine answered "couldn't decrypt password: input too short when
// revealing password - is it obscured?".
//
// A value that is ALREADY obscured is left alone. The screen sends back what it
// was given for a secret it did not touch, and obscuring it twice would produce
// a password nobody typed.
func forConnection(backend, key, value string) string {
	if value == "" || !needsObscure(backend, key) {
		return value
	}
	if _, err := obscure.Reveal(value); err == nil {
		return value
	}
	hidden, err := obscure.Obscure(value)
	if err != nil {
		// Nothing sensible to do here, and refusing the whole check over it
		// would turn a test button into an error about encoding.
		return value
	}
	return hidden
}

// quoteValue wraps a value unless it is made of characters that cannot mean
// anything else.
//
// AN ALLOW-LIST, not a list of separators to avoid. The first version quoted
// values containing a comma, a quote or a space - and a connection string is
// `:backend,k=v,k=v:`, so a COLON ends it too. Every WebDAV address has two, and
// the engine answered with a URL that had been eaten from the first one onward.
//
// Adding the colon would have fixed that address and left the next separator to
// be found by somebody whose target simply does not work. A deny-list of
// separators is never finished; this list is finished the moment it is written.
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
