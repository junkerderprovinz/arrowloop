// Package remotes manages the storage targets a job can point at.
//
// A target is an rclone remote and lives in rclone's own configuration file,
// not in a second one of our own. That is deliberate: somebody who already has
// an rclone.conf keeps their remotes, and anything set up here works from the
// rclone command line too. A tool that invented a parallel place to keep an S3
// key would be asking its user to maintain two.
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

// A credential must never leave this process, and deciding which settings are
// credentials is done by rule rather than by an exhaustive list, because rclone
// has some seventy backends and each names things its own way.
//
// The rule is: a setting whose name IS or ENDS IN one of these words. That
// deliberately does not catch access_key_id, which is the public half of an S3
// key pair and appears in every tutorial; hiding it would cost the screen its
// usefulness and protect nothing.
var secretWords = []string{"pass", "password", "secret", "key", "token", "credentials", "passphrase"}

// alwaysSecret are the ones the rule misses. key_pem is an SSH private key
// pasted inline, and its name ends in neither "key" nor anything else the rule
// looks for.
var alwaysSecret = map[string]bool{
	"key_pem":    true,
	"auth_token": true,
}

// IsSecret reports whether a setting's value must be withheld.
func IsSecret(key string) bool {
	if alwaysSecret[key] {
		return true
	}
	for _, word := range secretWords {
		if key == word || strings.HasSuffix(key, "_"+word) {
			return true
		}
	}
	return false
}

// Setting is one key of a remote. Value is empty and Secret is true for
// anything that must not be shown.
type Setting struct {
	Key    string `json:"key"`
	Value  string `json:"value"`
	Secret bool   `json:"secret"`
}

// Remote is one configured storage target.
type Remote struct {
	Name     string    `json:"name"`
	Type     string    `json:"type"`
	Settings []Setting `json:"settings"`
}

// List returns every remote rclone knows about, with the secrets withheld.
//
// A value that is set but hidden still reports that it is there, because
// "there is a password and you cannot see it" and "there is no password" are
// different facts and a screen that confuses them is worse than no screen.
func List() []Remote {
	data := config.LoadedData()
	names := data.GetSectionList()
	sort.Strings(names)

	out := make([]Remote, 0, len(names))
	for _, name := range names {
		r := Remote{Name: name}
		r.Type, _ = data.GetValue(name, "type")
		for _, key := range data.GetKeyList(name) {
			if key == "type" {
				continue
			}
			value, _ := data.GetValue(name, key)
			if IsSecret(key) {
				r.Settings = append(r.Settings, Setting{Key: key, Secret: true, Value: placeholderFor(value)})
				continue
			}
			r.Settings = append(r.Settings, Setting{Key: key, Value: value})
		}
		sort.Slice(r.Settings, func(i, j int) bool { return r.Settings[i].Key < r.Settings[j].Key })
		out = append(out, r)
	}
	return out
}

// Placeholder stands in for a secret that is set. It travels to the screen and
// back again unchanged, and coming back unchanged is what tells Save to leave
// the real value alone.
const Placeholder = "********"

// placeholderFor says whether a secret is set without saying what it is.
func placeholderFor(value string) string {
	if value == "" {
		return ""
	}
	return Placeholder
}

// Save writes a remote, obscuring anything that needs it.
//
// A secret whose submitted value is the placeholder is left exactly as it was.
// Without that rule, editing a remote's endpoint in a form would overwrite its
// password with eight asterisks, and the failure would only show up the next
// time the job ran.
func Save(name, backend string, settings map[string]string) error {
	if err := validName(name); err != nil {
		return err
	}
	if backend == "" {
		return fmt.Errorf("a remote needs a type, for example s3 or sftp")
	}
	if _, err := rclonefs.Find(backend); err != nil {
		return fmt.Errorf("this build does not include the %q backend: %w", backend, err)
	}

	data := config.LoadedData()
	existed := data.HasSection(name)
	data.SetValue(name, "type", backend)

	for key, value := range settings {
		if key == "type" {
			continue
		}
		if IsSecret(key) {
			if value == Placeholder {
				continue // came back untouched from the screen, so leave it be
			}
			if value == "" {
				data.DeleteKey(name, key)
				continue
			}
			hidden, err := obscure.Obscure(value)
			if err != nil {
				return fmt.Errorf("obscure %s: %w", key, err)
			}
			data.SetValue(name, key, hidden)
			continue
		}
		if value == "" {
			data.DeleteKey(name, key)
			continue
		}
		data.SetValue(name, key, value)
	}

	if err := data.Save(); err != nil {
		if !existed {
			data.DeleteSection(name)
		}
		return fmt.Errorf("write rclone's configuration: %w", err)
	}
	return nil
}

// Delete removes a remote.
func Delete(name string) error {
	data := config.LoadedData()
	if !data.HasSection(name) {
		return fmt.Errorf("no remote called %q", name)
	}
	data.DeleteSection(name)
	if err := data.Save(); err != nil {
		return fmt.Errorf("write rclone's configuration: %w", err)
	}
	return nil
}

// Check opens a remote and lists it, which is the only way to know whether the
// settings are right.
//
// Saving a credential proves nothing: a typo in an endpoint, a rotated key and
// a bucket that does not exist all look identical in a configuration file and
// all differ the moment somebody asks the server. The alternative is a job that
// looks configured and fails at three in the morning.
func Check(ctx context.Context, name string) error {
	f, err := rclonefs.NewFs(ctx, name+":")
	if err != nil {
		return err
	}
	// One listing of the root. Enough to prove the credentials work and the
	// address resolves, cheap enough not to matter on a large tree.
	if _, err := f.List(ctx, ""); err != nil && !isEmptyTarget(err) {
		return err
	}
	return nil
}

// isEmptyTarget reports whether an error only means the target does not exist
// yet, which is a perfectly good state for a remote somebody has just set up.
func isEmptyTarget(err error) bool {
	return err == rclonefs.ErrorDirNotFound || err == rclonefs.ErrorObjectNotFound
}

// validName keeps a remote name to what rclone itself will accept, and refuses
// the characters that would let a name change the meaning of a remote string.
func validName(name string) error {
	if name == "" {
		return fmt.Errorf("a remote needs a name")
	}
	if strings.ContainsAny(name, ":/\\,\"' \t") {
		return fmt.Errorf("a remote name cannot contain spaces, quotes, commas, slashes or colons: %q", name)
	}
	return nil
}
