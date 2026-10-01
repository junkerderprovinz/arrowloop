package remotes

import (
	"strings"
	"testing"

	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/obscure"
)

// crypt reveals password2 as it reveals password, so a salt stored as typed
// either fails to open or, when it happens to decode, salts with garbage.
func TestTheCryptSaltIsStoredObscured(t *testing.T) {
	const salt = "k9XvQ2mL7pR4tY8wZ1nB3cD6"
	saved(t, "vault", "crypt", map[string]string{
		"remote":    "/somewhere",
		"password":  "the password",
		"password2": salt,
	})

	stored, _ := config.LoadedData().GetValue("vault", "password2")
	if back, err := obscure.Reveal(stored); err != nil || back != salt {
		t.Fatalf("password2 is stored as %q, which crypt reveals to %q (%v), not the salt", stored, back, err)
	}
}

func TestTheCryptSaltIsWithheldFromTheListing(t *testing.T) {
	saved(t, "vault", "crypt", map[string]string{
		"remote":    "/somewhere",
		"password":  "the password",
		"password2": "the salt",
	})

	for _, s := range listed(t, "vault").Settings {
		if s.Key == "password2" && (!s.Secret || s.Value != Placeholder) {
			t.Fatalf("password2 was listed as %+v", s)
		}
	}
}

// Editing another field sends the salt back as the placeholder, which must
// leave it alone rather than store asterisks or obscure it a second time.
func TestEditingACryptTargetKeepsItsSalt(t *testing.T) {
	saved(t, "vault", "crypt", map[string]string{
		"remote":    "/somewhere",
		"password":  "the password",
		"password2": "the salt",
	})
	before, _ := config.LoadedData().GetValue("vault", "password2")

	if err := Save("vault", "crypt", formFor(listed(t, "vault"), "remote", "/elsewhere")); err != nil {
		t.Fatalf("save: %v", err)
	}
	if after, _ := config.LoadedData().GetValue("vault", "password2"); after != before {
		t.Fatalf("password2 went from %q to %q on an edit that did not touch it", before, after)
	}
}

// A salt saved as typed by an older build and accepted by crypt has already
// encrypted files with whatever it reveals to, so it has to stay exactly as it
// is.
func TestASaltStoredAsTypedSurvivesAnEdit(t *testing.T) {
	const raw = "k9XvQ2mL7pR4tY8wZ1nB3cD6"
	saved(t, "vault", "crypt", map[string]string{"remote": "/somewhere", "password": "the password"})
	data := config.LoadedData()
	data.SetValue("vault", "password2", raw)

	if err := Save("vault", "crypt", formFor(listed(t, "vault"), "remote", "/elsewhere")); err != nil {
		t.Fatalf("save: %v", err)
	}
	if got, _ := data.GetValue("vault", "password2"); got != raw {
		t.Fatalf("password2 = %q, want the stored %q untouched", got, raw)
	}
}

func listed(t *testing.T, name string) Remote {
	t.Helper()
	for _, r := range List() {
		if r.Name == name {
			return r
		}
	}
	t.Fatalf("%s is not listed", name)
	return Remote{}
}

// valueIn picks one bare value out of a connection string.
func valueIn(connection, key string) string {
	for _, part := range strings.Split(strings.Trim(connection, ":"), ",") {
		if k, v, ok := strings.Cut(part, "="); ok && k == key {
			return v
		}
	}
	return ""
}

// formFor is what the edit form sends back for r with one field changed.
func formFor(r Remote, key, value string) map[string]string {
	form := map[string]string{key: value}
	for _, s := range r.Settings {
		if s.Key != key {
			form[s.Key] = s.Value
		}
	}
	return form
}

// rclone marks these Sensitive rather than a password, and each one unlocks
// the account on its own while matching no secret word.
func TestCredentialsRcloneCallsSensitiveAreWithheld(t *testing.T) {
	for _, c := range []struct{ backend, key string }{
		{"storj", "access_grant"},
		{"azureblob", "sas_url"},
		{"azurefiles", "connection_string"},
		{"internxt", "mnemonic"},
		{"filen", "master_keys"},
		{"s3", "sse_customer_key_base64"},
		{"iclouddrive", "cookies"},
		{"mega", "session_id"},
	} {
		saved(t, "target", c.backend, map[string]string{c.key: "the credential"})
		for _, s := range listed(t, "target").Settings {
			if s.Key == c.key && (!s.Secret || s.Value != Placeholder) {
				t.Errorf("%s/%s was listed as %+v", c.backend, c.key, s)
			}
		}
	}
}

// rclone also marks the host and the user Sensitive, but somebody looking at
// a target needs to see which server and which account it is.
func TestWhoAndWhereStayVisible(t *testing.T) {
	saved(t, "box", "sftp", map[string]string{"host": "nas.example.invalid", "user": "someone"})

	for _, s := range listed(t, "box").Settings {
		if s.Secret {
			t.Errorf("%s was withheld", s.Key)
		}
	}
}

// The form takes a secret's placeholder back, which only works when it marks
// the same fields secret as the listing.
func TestTheFormAndTheListingWithholdTheSameFields(t *testing.T) {
	for _, b := range Backends() {
		for _, o := range b.Options {
			if o.Secret != IsSecret(b.Name, o.Name) {
				t.Errorf("%s/%s: form secret %v, listing secret %v", b.Name, o.Name, o.Secret, IsSecret(b.Name, o.Name))
			}
		}
	}
}

// Testing a target with a salt stored as typed has to use what crypt makes of
// that value, or the test and the saved target would disagree.
func TestASaltStoredAsTypedIsTestedAsCryptReadsIt(t *testing.T) {
	const raw = "k9XvQ2mL7pR4tY8wZ1nB3cD6"
	saved(t, "vault", "crypt", map[string]string{"remote": "/somewhere", "password": "the password"})
	config.LoadedData().SetValue("vault", "password2", raw)
	want, err := obscure.Reveal(raw)
	if err != nil {
		t.Fatalf("the example no longer decodes, so it shows nothing: %v", err)
	}

	got := connectionString("crypt", WithSavedSecrets("vault", map[string]string{"password2": Placeholder}))
	if back, err := obscure.Reveal(valueIn(got, "password2")); err != nil || back != want {
		t.Fatalf("the test would salt with %q (%v), the saved target with %q", back, err, want)
	}
}
