// Package remotes manages the storage targets a job can point at.
//
// A target is an rclone remote in rclone's own configuration file, so an
// existing rclone.conf keeps working and anything set up here works from the
// rclone command line too.
package remotes

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/obscure"
)

// secretWords decide by rule which settings are credentials that must never
// leave this process, since rclone's seventy backends each name them their own
// way. A setting is secret when its name is or ends in one of these words,
// which leaves out access_key_id, the public half of an S3 key pair.
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
	Name string `json:"name"`
	Type string `json:"type"`

	// Provider is the product behind the target, where the saved settings name
	// one, and Mark is its logo. Both are derived; see identify.go.
	Provider string `json:"provider,omitempty"`
	Mark     string `json:"mark,omitempty"`

	Settings []Setting `json:"settings"`
}

// List returns every remote rclone knows about, with the secrets withheld. A
// secret that is set still reports that it is there.
func List() []Remote {
	data := config.LoadedData()
	names := data.GetSectionList()
	sort.Strings(names)

	out := make([]Remote, 0, len(names))
	for _, name := range names {
		// Not nil: a remote with nothing but a type would marshal its settings
		// as null and break the page.
		r := Remote{Name: name, Settings: []Setting{}}
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
		// The provider is read from the settings gathered above.
		r.Provider = ProviderFor(r)
		r.Mark = MarkFor(r)
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

// Save writes a remote, obscuring anything that needs it. A secret submitted as
// the placeholder is left as it was, so editing another field in a form does
// not overwrite the password with asterisks.
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
		// Withholding and obscuring are separate questions: a value is obscured
		// only if rclone unobscures it on reading. S3's secret_access_key is
		// withheld but stored plain. See obscuring.go.
		if IsSecret(key) {
			if value == Placeholder {
				continue // came back untouched from the screen, so leave it be
			}
			if value == "" {
				data.DeleteKey(name, key)
				continue
			}
			if needsObscure(backend, key) {
				hidden, err := obscure.Obscure(value)
				if err != nil {
					return fmt.Errorf("obscure %s: %w", key, err)
				}
				data.SetValue(name, key, hidden)
				continue
			}
			data.SetValue(name, key, value)
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
func Check(ctx context.Context, name string) error {
	// rclone has no deadline here and the operating system's is minutes long,
	// so an address the device cannot route to would leave the check hanging.
	ctx, stop := context.WithTimeout(ctx, CheckWait)
	defer stop()

	f, err := rclonefs.NewFs(ctx, name+":")
	if err != nil {
		return checkErr(ctx, err)
	}
	// One listing of the root proves the credentials and the address.
	if _, err := f.List(ctx, ""); err != nil && !isEmptyTarget(err) {
		return checkErr(ctx, err)
	}
	return nil
}

// CheckWait is how long a target gets to answer before it counts as
// unreachable: long enough for a slow cloud on a bad connection to list.
const CheckWait = 30 * time.Second

// checkErr says when the deadline stopped the check, since rclone's
// wording for a cancelled request reads like an internal fault.
func checkErr(ctx context.Context, err error) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fmt.Errorf("no answer within %s: %w", CheckWait, err)
	}
	return err
}

// Usage is how full a target is, as far as the target is willing to say. The
// fields are pointers because unknown is common and is not zero: S3 has no
// quota to report, while a full disk reports Free as a real zero.
type Usage struct {
	// Supported is false when the backend cannot answer at all, as with most
	// bucket stores and a plain SFTP login.
	Supported bool   `json:"supported"`
	Total     *int64 `json:"total,omitempty"`
	Used      *int64 `json:"used,omitempty"`
	Free      *int64 `json:"free,omitempty"`
	Trashed   *int64 `json:"trashed,omitempty"`
	Other     *int64 `json:"other,omitempty"`
}

// About asks a target how much room is left on it. A backend that cannot say
// is not an error: it returns a Usage with Supported false.
func About(ctx context.Context, name string) (Usage, error) {
	// An address the device cannot route to hangs rather than refusing, for
	// minutes on Android.
	ctx, done := context.WithTimeout(ctx, CheckWait)
	defer done()

	f, err := rclonefs.NewFs(ctx, name+":")
	if err != nil {
		return Usage{}, err
	}
	ask := f.Features().About
	if ask == nil {
		return Usage{}, nil
	}
	got, err := ask(ctx)
	if err != nil {
		return Usage{}, err
	}
	if got == nil {
		return Usage{}, nil
	}
	return Usage{
		Supported: true,
		Total:     got.Total,
		Used:      got.Used,
		Free:      got.Free,
		Trashed:   got.Trashed,
		Other:     got.Other,
	}, nil
}

// isEmptyTarget reports whether an error only means the target does not exist
// yet, which is fine for a remote that was just set up.
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
