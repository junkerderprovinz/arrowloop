package remotes

import "testing"

// saved writes one target into a config of this test's own.
func saved(t *testing.T, name, backend string, settings map[string]string) {
	t.Helper()
	ownConfig(t)
	if err := Save(name, backend, settings); err != nil {
		t.Fatalf("save %s: %v", name, err)
	}
}

// A secret is withheld on its way to the screen, so a form editing a saved
// target sends no password, and checking it must use the saved one.
func TestAnAbsentSecretComesFromTheSavedTarget(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{
		"url":  "https://example.invalid/remote.php/webdav",
		"user": "someone",
		"pass": "letmein",
	})

	// What the form sends while editing: empty values are pruned.
	got := WithSavedSecrets("cloud", "webdav", map[string]string{
		"url":  "https://example.invalid/remote.php/webdav",
		"user": "someone",
	})

	if got["pass"] != "letmein" {
		t.Fatalf("pass = %q, want the saved password", got["pass"])
	}
}

// The desktop fills the box with the placeholder rather than leaving it blank.
func TestThePlaceholderMeansTheSavedSecretToo(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "letmein"})

	got := WithSavedSecrets("cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": Placeholder})
	if got["pass"] != "letmein" {
		t.Fatalf("pass = %q, want the saved password", got["pass"])
	}
}

// Somebody changing a credential checks whether the new one works.
func TestATypedSecretIsNotOverwritten(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "letmein"})

	got := WithSavedSecrets("cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "the-new-one"})
	if got["pass"] != "the-new-one" {
		t.Fatalf("pass = %q, want the one that was typed", got["pass"])
	}
}

// A visible field somebody cleared stays cleared, as the screen shows it.
func TestAVisibleFieldIsNeverFilledIn(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{
		"url":  "https://example.invalid/",
		"user": "someone",
		"pass": "letmein",
	})

	got := WithSavedSecrets("cloud", "webdav", map[string]string{"url": "https://example.invalid/", "user": ""})
	if got["user"] != "" {
		t.Fatalf("user = %q, want the empty value the form sent", got["user"])
	}
}

// A target being created has nothing to fill in from.
func TestAnUnsavedTargetPassesStraightThrough(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "letmein"})

	for _, name := range []string{"", "   ", "not-a-target"} {
		in := map[string]string{"url": "https://example.invalid/"}
		got := WithSavedSecrets(name, "webdav", in)
		if _, filled := got["pass"]; filled {
			t.Errorf("%q invented a password", name)
		}
	}
}

// The caller's map is a decoded request body that other code reads afterwards.
func TestTheCallersMapIsLeftAlone(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{"url": "https://example.invalid/", "pass": "letmein"})

	in := map[string]string{"url": "https://example.invalid/"}
	_ = WithSavedSecrets("cloud", "webdav", in)
	if _, grew := in["pass"]; grew {
		t.Fatal("the map that was passed in gained a password")
	}
}

// A saved password goes only where it was saved for. Otherwise a check with
// the target's name and somebody else's address would send it there.
func TestASavedSecretDoesNotFollowAnotherAddress(t *testing.T) {
	saved(t, "cloud", "webdav", map[string]string{
		"url":  "https://example.invalid/remote.php/webdav",
		"user": "someone",
		"pass": "letmein",
	})

	forms := map[string]struct {
		backend  string
		settings map[string]string
	}{
		"another url":  {"webdav", map[string]string{"url": "https://attacker.invalid/", "user": "someone"}},
		"another user": {"webdav", map[string]string{"url": "https://example.invalid/remote.php/webdav", "user": "else"}},
		"another type": {"sftp", map[string]string{"host": "attacker.invalid", "url": "https://example.invalid/remote.php/webdav", "user": "someone"}},
	}
	for what, form := range forms {
		got := WithSavedSecrets("cloud", form.backend, form.settings)
		if _, filled := got["pass"]; filled {
			t.Errorf("%s got the saved password", what)
		}
	}
}

// Settings other than the address also decide where a connection goes: a
// proxy, a host key check turned off, an API endpoint of the backend's own.
func TestASavedSecretDoesNotFollowAnyChangedSetting(t *testing.T) {
	saved(t, "box", "sftp", map[string]string{
		"host":             "files.example.invalid",
		"user":             "someone",
		"known_hosts_file": "/home/someone/.ssh/known_hosts",
		"pass":             "letmein",
	})
	same := map[string]string{
		"host":             "files.example.invalid",
		"user":             "someone",
		"known_hosts_file": "/home/someone/.ssh/known_hosts",
	}

	forms := map[string]map[string]string{
		"a proxy added":            {"socks_proxy": "attacker.invalid:1080"},
		"an http proxy added":      {"http_proxy": "http://attacker.invalid:8080"},
		"host keys left unchecked": {"known_hosts_file": "none"},
		"host key file dropped":    {"known_hosts_file": ""},
	}
	for what, change := range forms {
		form := map[string]string{}
		for key, value := range same {
			form[key] = value
		}
		for key, value := range change {
			form[key] = value
		}
		got := WithSavedSecrets("box", "sftp", form)
		if _, filled := got["pass"]; filled {
			t.Errorf("%s got the saved password", what)
		}
	}

	// What the edit form sends back unchanged still gets the password, with the
	// secret empty or at the placeholder.
	for _, pass := range []string{"", Placeholder} {
		form := map[string]string{"pass": pass}
		for key, value := range same {
			form[key] = value
		}
		if got := WithSavedSecrets("box", "sftp", form); got["pass"] != "letmein" {
			t.Errorf("the unchanged form with pass %q got %q, want the saved password", pass, got["pass"])
		}
	}
}
