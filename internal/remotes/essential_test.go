package remotes_test

import (
	"testing"

	_ "github.com/rclone/rclone/backend/s3"
	_ "github.com/rclone/rclone/backend/sftp"
	_ "github.com/rclone/rclone/backend/smb"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

// s3 marks none of its options required, so a form showing only rclone's
// required options would open empty.
func TestEveryOfferedBackendAsksForSomething(t *testing.T) {
	backends := remotes.Backends()
	if len(backends) < 3 {
		t.Fatalf("expected the compiled-in backends, got %d", len(backends))
	}

	for _, b := range backends {
		visible, askable := 0, 0
		for _, o := range b.Options {
			if o.Required || o.Essential {
				visible++
			}
			if !o.Advanced {
				askable++
			}
		}
		// A backend with no ordinary options, such as memory, has nothing to
		// ask for.
		if askable == 0 {
			continue
		}
		if visible == 0 {
			t.Errorf("the %s form opens with no fields at all, so a target can be saved "+
				"with nothing in it and fails on first use instead of on save (%d options, "+
				"all of them behind the advanced switch)", b.Name, len(b.Options))
		}
	}
}

// Named per backend, since an option name alone does not say whether it is a
// credential.
func TestTheCredentialsAreOnTheFirstScreen(t *testing.T) {
	want := map[string][]string{
		"s3":   {"access_key_id", "secret_access_key"},
		"smb":  {"user", "pass"},
		"sftp": {"user"},
	}
	for _, b := range remotes.Backends() {
		names, ok := want[b.Name]
		if !ok {
			continue
		}
		shown := map[string]bool{}
		for _, o := range b.Options {
			if o.Required || o.Essential {
				shown[o.Name] = true
			}
		}
		for _, n := range names {
			if !shown[n] {
				t.Errorf("the %s form does not ask for %q before the advanced switch, "+
					"so it looks complete without a credential in it", b.Name, n)
			}
		}
	}
}
