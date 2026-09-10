package remotes

import (
	"testing"

	_ "github.com/rclone/rclone/backend/all"
)

// How a product wants to be signed into, and what happens when nobody knows.
//
// The sentence this decides is shown beside the one field somebody is most
// likely to get wrong, so a WRONG answer here is worse than none: telling
// somebody there is nothing to fetch, in front of a service that wants a
// generated token, sends them looking in the wrong place with confidence. Every
// test below is therefore about restraint as much as about coverage.

func styleOf(t *testing.T, id string) AuthStyle {
	t.Helper()
	for _, p := range Providers() {
		if p.ID == id {
			return p.Auth
		}
	}
	t.Fatalf("no provider %q - the table was renamed and this test was not", id)
	return ""
}

// TestTheShapeOfTheFieldsAnswersForMostProducts.
//
// The point of deriving at all: fifty-one products, and looking each one up by
// hand gives a table that is right the day it is written and quietly wrong a
// year later. rclone ships what each backend asks for with every build.
func TestTheShapeOfTheFieldsAnswersForMostProducts(t *testing.T) {
	for _, c := range []struct {
		id   string
		want AuthStyle
	}{
		// A public half and a secret half, made together in a console. The
		// three spellings of one idea: S3's own pair, b2's account and key,
		// netstorage's account and secret.
		{"s3", AuthAccessKey},
		{"b2", AuthAccessKey},
		{"netstorage", AuthAccessKey},
		// A name and a password, with nothing to fetch first.
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

// TestTheHandWrittenStyleBeatsTheShape.
//
// Where the two disagree, the hand-written one is the one that knows. Nextcloud
// asks for a user and a password like any ordinary login, and with two-factor
// authentication switched on the login password cannot work at all - which no
// option list anywhere says. If the derivation ever overwrote these, the
// interface would start telling people to use the password that cannot work.
func TestTheHandWrittenStyleBeatsTheShape(t *testing.T) {
	for _, id := range []string{"nextcloud", "owncloud", "opencloud", "seafile", "koofr", "icloud"} {
		if got := styleOf(t, id); got != AuthAppPassword {
			t.Errorf("%s: %q, wanted the hand-written %q", id, got, AuthAppPassword)
		}
	}
}

// TestABackendReachedByBrowserSaysNothingHere.
//
// Those already announce themselves through NeedsToken, and the form prints its
// own note above the fields. A second sentence beside a box nobody can type
// into is the same news twice, which is how a bubble ends up being ignored.
func TestABackendReachedByBrowserSaysNothingHere(t *testing.T) {
	for _, id := range []string{"dropbox", "gdrive", "onedrive", "box"} {
		if got := styleOf(t, id); got != "" {
			t.Errorf("%s: %q, wanted silence - the form already says it signs in through a browser", id, got)
		}
	}
}

// TestAnUnreadableShapeStaysSilent.
//
// The restraint half, and the one worth having a test for. Swift offers three
// different credential routes among its advanced options and requires none of
// them; Oracle reads a config file off the disk. Neither has an answer that
// would be true, so neither gets a sentence, and the field falls back to what
// it said before any of this existed.
func TestAnUnreadableShapeStaysSilent(t *testing.T) {
	for _, id := range []string{"swift", "oracle"} {
		if got := styleOf(t, id); got != "" {
			t.Errorf("%s: %q, wanted silence rather than a guess", id, got)
		}
	}
}

// TestATokenBesideAPasswordIsNotAPlainLogin.
//
// The exclusion that keeps the login sentence honest, and it earns its place:
// all three of these ask for an email, a password AND a token, so the shape
// alone reads as an ordinary login. Telling somebody "nothing has to be fetched
// first" in front of the three products where there IS something to fetch is
// the worst possible place to be confidently wrong, and it is what this
// derivation did until the field lists were read rather than assumed.
func TestATokenBesideAPasswordIsNotAPlainLogin(t *testing.T) {
	for _, id := range []string{"linkbox", "ulozto", "filen"} {
		if got := styleOf(t, id); got == AuthLogin {
			t.Errorf("%s: called a plain login, but its form also asks for a token", id)
		}
	}
}

// TestOnlyTheFieldsSomebodyIsShownAreRead.
//
// The advanced options carry credentials for cases nobody here is in, and
// reading them would label a backend by a route its own form never offers. This
// pins the rule rather than one example of it: no style may be decided by an
// option the form does not show.
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
		// A derived style has to be reachable from the shown fields alone.
		// Hand-written ones are exempt: they exist precisely because the shown
		// fields do not say it.
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
