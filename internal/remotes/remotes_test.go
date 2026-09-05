package remotes

import "testing"

// TestIsSecret pins which settings may reach a browser. A credential that
// leaks because somebody added a backend whose password field has an unusual
// name is not a bug anybody notices until it matters.
func TestIsSecret(t *testing.T) {
	secret := []string{
		"pass", "password", "secret", "client_secret", "secret_access_key",
		"token", "auth_token", "service_account_credentials", "key", "key_pem",
		"sa_credentials", "passphrase",
	}
	for _, key := range secret {
		if !IsSecret(key) {
			t.Errorf("%q would be sent to the browser in clear", key)
		}
	}

	// The public half of an S3 key pair appears in every tutorial. Hiding it
	// costs the screen its usefulness and protects nothing.
	open := []string{"access_key_id", "endpoint", "region", "host", "port", "user", "type", "provider"}
	for _, key := range open {
		if IsSecret(key) {
			t.Errorf("%q was withheld, which leaves the screen unable to show a setting somebody has to check", key)
		}
	}
}

// TestPlaceholderDistinguishesSetFromUnset covers the difference a screen has
// to be able to show: "there is a password and you cannot see it" and "there is
// no password" are different facts.
func TestPlaceholderDistinguishesSetFromUnset(t *testing.T) {
	if placeholderFor("") != "" {
		t.Error("an unset secret was reported as set")
	}
	if placeholderFor("hunter2") != Placeholder {
		t.Error("a set secret was not reported as set")
	}
	if placeholderFor("hunter2") == "hunter2" {
		t.Fatal("the real value was handed out")
	}
}

// TestNamesThatWouldChangeMeaningAreRefused. A remote name ends up inside an
// rclone remote string, where a colon or a comma separates one thing from
// another. A name carrying one would not be a name any more.
func TestNamesThatWouldChangeMeaningAreRefused(t *testing.T) {
	for _, name := range []string{"", "with space", "with:colon", "with,comma", `with"quote`, "with/slash"} {
		if err := validName(name); err == nil {
			t.Errorf("%q was accepted as a remote name", name)
		}
	}
	for _, name := range []string{"backup", "s3-cold", "bottich_sftp", "photos2"} {
		if err := validName(name); err != nil {
			t.Errorf("%q is a perfectly ordinary name and was refused: %v", name, err)
		}
	}
}
