package remotes

import (
	"testing"

	rclonefs "github.com/rclone/rclone/fs"
)

// rclone reads secret_access_key verbatim, so an obscured one signs requests
// with a scrambled string.
func TestTheS3SecretIsNotObscured(t *testing.T) {
	if needsObscure("s3", "secret_access_key") {
		t.Fatal("s3 secret_access_key must be stored verbatim: rclone never reveals it")
	}
	if !IsSecret("secret_access_key") {
		t.Fatal("s3 secret_access_key must still be withheld from the screen")
	}
}

func TestTheWebdavPasswordIsObscured(t *testing.T) {
	if !needsObscure("webdav", "pass") {
		t.Fatal("webdav pass must be obscured: rclone reveals it on read")
	}
}

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

// For every secret-named option of every backend, obscuring follows rclone's
// own IsPassword.
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
	// An empty registry would pass the loop vacuously.
	if checked < 20 {
		t.Fatalf("only %d secret-named options seen; the registry cannot be that small", checked)
	}
}
