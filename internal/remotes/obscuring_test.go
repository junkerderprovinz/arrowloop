package remotes

import (
	"testing"

	rclonefs "github.com/rclone/rclone/fs"
)

// THE BUG THIS FILE EXISTS FOR.
//
// S3's secret_access_key ends in "_key", so the name rule called it a secret and
// obscured it. rclone declares it `Sensitive` and not `IsPassword`, so it reads
// back whatever stands in the file VERBATIM - and every S3 target this program
// wrote therefore signed its requests with a scrambled string. It fails as
// "Invalid signature" from a key ID the server recognises, which reads like a
// wrong password rather than like a bug in the writer.
func TestTheS3SecretIsNotObscured(t *testing.T) {
	if needsObscure("s3", "secret_access_key") {
		t.Fatal("s3 secret_access_key must be stored verbatim: rclone never reveals it")
	}
	// Still withheld from the screen. The two questions are separate, and this
	// is the half that was always right.
	if !IsSecret("secret_access_key") {
		t.Fatal("s3 secret_access_key must still be withheld from the screen")
	}
}

// The other half: WebDAV's password really is obscured by rclone, so it must be
// obscured here too. Getting this one wrong writes a plaintext password into the
// file AND breaks the login, because rclone would try to reveal it.
func TestTheWebdavPasswordIsObscured(t *testing.T) {
	if !needsObscure("webdav", "pass") {
		t.Fatal("webdav pass must be obscured: rclone reveals it on read")
	}
}

// An unknown backend, and an option a backend does not have, both fall to
// verbatim. That is the safe direction: a value stored plainly that rclone wanted
// obscured is visible and fixable, while a value obscured that rclone wanted
// plainly is a credential that silently never works.
func TestTheUnknownFallsToVerbatim(t *testing.T) {
	for _, c := range []struct{ backend, key string }{
		{"not-a-backend", "pass"},
		{"s3", "not-an-option"},
	} {
		if needsObscure(c.backend, c.key) {
			t.Errorf("%s/%s: should fall to verbatim", c.backend, c.key)
		}
	}
}

// THE RULE, checked against rclone rather than restated.
//
// Every option of every backend this build carries: if the name rule calls it a
// secret, then obscuring it must follow rclone's own answer and nothing else.
// This is the test that would have caught the original bug on the day the name
// rule was written, because it never asks what a field is CALLED.
func TestObscuringFollowsRcloneForEveryBackendOption(t *testing.T) {
	checked := 0
	for _, info := range rclonefs.Registry {
		for _, option := range info.Options {
			if !IsSecret(option.Name) {
				continue
			}
			checked++
			want := option.IsPassword
			if got := needsObscure(info.Name, option.Name); got != want {
				t.Errorf("%s/%s: obscure = %v, rclone says %v", info.Name, option.Name, got, want)
			}
		}
	}
	// A pass over nothing proves nothing. This build carries dozens of
	// backends, and a registry that came back empty would make every assertion
	// above vacuously true.
	if checked < 20 {
		t.Fatalf("only %d secret-named options seen; the registry cannot be that small", checked)
	}
}
