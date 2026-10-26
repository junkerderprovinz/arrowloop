package remotes_test

import (
	"testing"

	_ "github.com/rclone/rclone/backend/iclouddrive"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

func TestICloudAsksForTheSessionItCannotSignInWithout(t *testing.T) {
	for _, name := range []string{"trust_token", "cookies"} {
		if o := option(t, "iclouddrive", name); !o.Essential {
			t.Errorf("iCloud Drive's %s is not among the fields everybody fills in", name)
		}
	}
	for _, p := range remotes.Providers() {
		if p.ID == "icloud" && p.Auth != remotes.AuthLogin {
			t.Errorf("iCloud Drive signs in with %q, but Apple refuses app passwords", p.Auth)
		}
	}
}
