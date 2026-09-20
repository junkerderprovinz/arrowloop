package remotes

import (
	"testing"

	_ "github.com/rclone/rclone/backend/all"
)

func styleOf(t *testing.T, id string) AuthStyle {
	t.Helper()
	for _, p := range Providers() {
		if p.ID == id {
			return p.Auth
		}
	}
	t.Fatalf("no provider %q; the table was renamed and this test was not", id)
	return ""
}

func TestTheShapeOfTheFieldsAnswersForMostProducts(t *testing.T) {
	for _, c := range []struct {
		id   string
		want AuthStyle
	}{
		{"s3", AuthAccessKey},
		{"b2", AuthAccessKey},
		{"netstorage", AuthAccessKey},
		{"mega", AuthLogin},
		{"smb", AuthLogin},
		{"pikpak", AuthLogin},
		{"opendrive", AuthLogin},
	} {
		if got := styleOf(t, c.id); got != c.want {
			t.Errorf("%s: %q, wanted %q", c.id, got, c.want)
		}
	}
}

// Nextcloud's fields look like an ordinary login, but with two-factor
// authentication on the login password cannot work.
func TestTheHandWrittenStyleBeatsTheShape(t *testing.T) {
	for _, id := range []string{"nextcloud", "owncloud", "opencloud", "seafile", "koofr", "icloud"} {
		if got := styleOf(t, id); got != AuthAppPassword {
			t.Errorf("%s: %q, wanted the hand-written %q", id, got, AuthAppPassword)
		}
	}
}

// NeedsToken already puts a note above the fields.
func TestABackendReachedByBrowserSaysNothingHere(t *testing.T) {
	for _, id := range []string{"dropbox", "gdrive", "onedrive", "box"} {
		if got := styleOf(t, id); got != "" {
			t.Errorf("%s: %q, wanted silence; the form already says it signs in through a browser", id, got)
		}
	}
}

// Swift offers three credential routes among its advanced options and Oracle
// reads a config file off the disk, so neither has a true answer.
func TestAnUnreadableShapeStaysSilent(t *testing.T) {
	for _, id := range []string{"swift", "oracle"} {
		if got := styleOf(t, id); got != "" {
			t.Errorf("%s: %q, wanted silence rather than a guess", id, got)
		}
	}
}

// These ask for an email, a password and a token.
func TestATokenBesideAPasswordIsNotAPlainLogin(t *testing.T) {
	for _, id := range []string{"linkbox", "ulozto", "filen"} {
		if got := styleOf(t, id); got == AuthLogin {
			t.Errorf("%s: called a plain login, but its form also asks for a token", id)
		}
	}
}

// No style may be decided by an option the form does not show.
func TestOnlyTheFieldsSomebodyIsShownAreRead(t *testing.T) {
	byName := map[string]Backend{}
	for _, b := range Backends() {
		byName[b.Name] = b
	}
	for _, p := range Providers() {
		if p.Auth == "" {
			continue
		}
		b, ok := byName[p.Backend]
		if !ok {
			continue
		}
		// Hand-written styles are exempt: they exist because the shown fields
		// do not say it.
		if derivedAuth(b) == "" {
			continue
		}
		shown := 0
		for _, o := range b.Options {
			if o.Required || o.Essential {
				shown++
			}
		}
		if shown == 0 {
			t.Errorf("%s: a style was derived from a backend whose form shows no fields at all", p.ID)
		}
	}
}
