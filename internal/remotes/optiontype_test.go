package remotes_test

import (
	"testing"

	_ "github.com/rclone/rclone/backend/ftp"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

func option(t *testing.T, backend, name string) remotes.Option {
	t.Helper()
	for _, b := range remotes.Backends() {
		if b.Name != backend {
			continue
		}
		for _, o := range b.Options {
			if o.Name == name {
				return o
			}
		}
	}
	t.Fatalf("%s has no option %s", backend, name)
	return remotes.Option{}
}

func TestAYesOrNoSettingSaysSoAndThatItIsOff(t *testing.T) {
	for _, name := range []string{"tls", "explicit_tls"} {
		o := option(t, "ftp", name)
		if o.Type != "bool" || o.Default != "false" {
			t.Errorf("ftp %s: type %q, default %q; want a bool that is off", name, o.Type, o.Default)
		}
	}
}

func TestATextSettingIsNoSwitch(t *testing.T) {
	if o := option(t, "ftp", "host"); o.Type != "string" {
		t.Errorf("ftp host has type %q", o.Type)
	}
}
