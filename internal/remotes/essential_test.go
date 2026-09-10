package remotes_test

import (
	"testing"

	_ "github.com/rclone/rclone/backend/s3"
	_ "github.com/rclone/rclone/backend/sftp"
	_ "github.com/rclone/rclone/backend/smb"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

// Every backend this build offers can actually be filled in.
//
// The defect this guards against had no symptom until somebody tried to use it:
// the setup form showed rclone's `required` options and nothing else, and s3
// marks NONE of its seventy-eight options required. So the one backend somebody
// would point at a cloud provider opened as an empty form, and a target could be
// saved with no credentials at all - it then failed on first use with an error
// about the connection rather than about the empty form that produced it.
//
// The test is deliberately about the FORM rather than about the map: what
// matters is that a person sees somewhere to put a credential, whichever
// mechanism puts it there.
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
		// A backend with NO ordinary options at all has nothing to ask for, and
		// demanding a field from it would be demanding an invention. `memory`
		// is the one: a scratch remote that lives in RAM and takes no address
		// and no credential.
		//
		// Structural rather than a list of names on purpose. "This backend is
		// exempt" and "this backend hides everything behind advanced" look
		// identical from a name list, and the second is exactly the defect this
		// test exists for: s3 has plenty of ordinary options and marks none of
		// them required.
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

// TestTheCredentialsAreOnTheFirstScreen, for the backends that need them.
//
// A form with one box for a hostname and the password behind an advanced switch
// is a form that looks finished and is not. Named per backend rather than by
// pattern-matching option names: "pass" is a credential on smb and part of a
// key passphrase elsewhere, and a rule clever enough to tell them apart would
// be a rule nobody can check by reading.
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
