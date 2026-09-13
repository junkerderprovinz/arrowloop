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
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

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
	Name string `json:"name"`
	Type string `json:"type"`

	// Provider is the PRODUCT behind the target, where the saved settings name
	// one, and Mark is its logo. Both are derived rather than stored: see
	// identify.go for why a backend alone cannot answer this, and why the
	// answer belongs here rather than in each interface.
	Provider string `json:"provider,omitempty"`
	Mark     string `json:"mark,omitempty"`

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
		// Started as an empty slice rather than left nil, because a nil slice
		// marshals to `null` and not to `[]`. A target saved with nothing but a
		// type, which is exactly what the "create" form produces before anybody
		// fills a field in, therefore arrived in the browser as a settings list
		// that was not a list, and the first thing the row did with it took the
		// whole page down. Found by making one.
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
		// Named AFTER the settings are gathered, because that is what names it.
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
		// WITHHOLDING and OBSCURING are two different questions, and they used
		// to share one answer. A value is withheld from the screen because a
		// person should not read it; a value is obscured because rclone will
		// UNOBSCURE it when it reads the file back. S3's secret_access_key is
		// the first but not the second, and obscuring it wrote a credential
		// that could never work. See obscuring.go.
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
//
// Saving a credential proves nothing: a typo in an endpoint, a rotated key and
// a bucket that does not exist all look identical in a configuration file and
// all differ the moment somebody asks the server. The alternative is a job that
// looks configured and fails at three in the morning.
func Check(ctx context.Context, name string) error {
	// A DEADLINE, because rclone has none here and the operating system's own
	// is measured in minutes. Found on a phone that had moved to mobile data and
	// could no longer route to a target on a private address: the button said
	// "checking" for over four minutes, which is indistinguishable from the app
	// being stuck. This button asks one question - can the engine reach that
	// target - and "no" is a good answer; waiting forever is not an answer.
	//
	// Thirty seconds is long enough for a slow cloud on a bad connection to
	// finish an authenticated listing, and short enough that somebody watching
	// it learns something while still watching.
	ctx, stop := context.WithTimeout(ctx, CheckWait)
	defer stop()

	f, err := rclonefs.NewFs(ctx, name+":")
	if err != nil {
		return checkErr(ctx, err)
	}
	// One listing of the root. Enough to prove the credentials work and the
	// address resolves, cheap enough not to matter on a large tree.
	if _, err := f.List(ctx, ""); err != nil && !isEmptyTarget(err) {
		return checkErr(ctx, err)
	}
	return nil
}

// CheckWait is how long a target gets to answer before it counts as unreachable.
const CheckWait = 30 * time.Second

// checkErr says plainly when the deadline was what stopped it.
//
// Without this the caller sees rclone's own wording for a cancelled request,
// which reads like an internal fault rather than like "this address did not
// answer" - and the difference matters to somebody deciding whether they typed
// the address wrong or their phone simply cannot reach it.
func checkErr(ctx context.Context, err error) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fmt.Errorf("no answer within %s: %w", CheckWait, err)
	}
	return err
}

// Usage is how full a target is, as far as the target is willing to say.
//
// Every field is a POINTER because "unknown" is the common answer and it is not
// zero. A bucket store has no size: S3 will happily take another terabyte and
// has no notion of a quota to report, so Total there is genuinely absent, while
// a full disk reports Free as a real zero. Collapsing those two into the same
// number puts "0 bytes free" on a target that has no limit at all, which reads
// as an emergency.
type Usage struct {
	// Supported is false when the backend has no way to answer at all, which is
	// the honest state for most bucket stores and for a plain SFTP login.
	Supported bool   `json:"supported"`
	Total     *int64 `json:"total,omitempty"`
	Used      *int64 `json:"used,omitempty"`
	Free      *int64 `json:"free,omitempty"`
	Trashed   *int64 `json:"trashed,omitempty"`
	Other     *int64 `json:"other,omitempty"`
}

// About asks a target how much room is left on it.
//
// jdp asked for this among the small ones, and it answers the question a person
// has BEFORE a sync rather than after: a job that copies eighty gigabytes onto a
// cloud drive with twelve left fails eighty gigabytes in, having spent an
// evening on it, and the number that would have said so was one request away.
//
// A backend that does not implement it is not an error. rclone's own `about`
// prints a refusal for those, and so does this: `Supported: false` travels to
// the screen and the screen says nothing about space rather than guessing.
func About(ctx context.Context, name string) (Usage, error) {
	// A DEADLINE, the same one the reachability check carries and for a sharper
	// reason. A target on an address this device cannot route to does not
	// refuse the connection - it hangs until the network stack gives up, which
	// on Android is minutes. Without a limit here a card sat on "wird gesucht"
	// for the whole time, which reads as a screen that is broken rather than as
	// a target that is out of reach. Measured on jdp's phone against a target
	// in a VLAN the phone cannot see.
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
