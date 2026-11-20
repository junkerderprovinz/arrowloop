package remotes

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configmap"
	"github.com/rclone/rclone/fs/config/obscure"
)

// internxtLogins counts the sign-ins the fake Internxt setup made.
var internxtLogins int

// fakeInternxt walks the states of rclone's Internxt setup, which would ask
// Internxt's servers whether the account has two-factor sign-in and then
// trade the password for the mnemonic and a token. An address starting with
// "2fa" has two-factor sign-in, the password is "right" and the code 123456.
var fakeInternxt = &rclonefs.RegInfo{
	Name:    "internxt",
	Options: []rclonefs.Option{{Name: "email"}, {Name: "pass", IsPassword: true}, {Name: "mnemonic", Sensitive: true}},
	Config: func(_ context.Context, _ string, m configmap.Mapper, in rclonefs.ConfigIn) (*rclonefs.ConfigOut, error) {
		email, _ := m.Get("email")
		switch in.State {
		case "":
			if strings.HasPrefix(email, "2fa") {
				return rclonefs.ConfigInput("2fa", "config_2fa", "Two-factor authentication code")
			}
			return rclonefs.ConfigGoto("login")
		case "2fa":
			m.Set("2fa_code", in.Result)
			return rclonefs.ConfigGoto("login")
		case "login":
			pass, _ := m.Get("pass")
			if plain, err := obscure.Reveal(pass); err != nil || plain != "right" {
				return nil, errors.New("login failed: failed to access: access: Wrong login credentials (status 401)")
			}
			if code, _ := m.Get("2fa_code"); strings.HasPrefix(email, "2fa") && code != "123456" {
				return nil, errors.New("login failed: failed to access: access: Wrong 2-factor auth code (status 401)")
			}
			internxtLogins++
			m.Set("mnemonic", obscure.MustObscure("abandon ability able"))
			m.Set("token", `{"access_token":"jwt"}`)
			m.Set("2fa_code", "")
			return nil, nil
		}
		return nil, nil
	},
}

func init() {
	fakes["internxt"] = fakeInternxt
}

func TestSigningInToInternxtFetchesTheMnemonicAndAToken(t *testing.T) {
	got, q, err := Setup(context.Background(), "internxt", map[string]string{"email": "me@example.invalid", "pass": "right"})
	if err != nil || q != nil {
		t.Fatalf("setup = %+v, %v", q, err)
	}
	if mnemonic, err := obscure.Reveal(got["mnemonic"]); err != nil || mnemonic != "abandon ability able" {
		t.Fatalf("mnemonic = %q, want the one the sign-in fetched, obscured as rclone keeps it", got["mnemonic"])
	}
	if got["token"] != `{"access_token":"jwt"}` {
		t.Fatalf("token = %q, want the one the sign-in fetched", got["token"])
	}
}

func TestAnInternxtAccountWithTwoFactorSignInIsAskedForTheCode(t *testing.T) {
	form := map[string]string{"email": "2fa@example.invalid", "pass": "right"}
	_, q, err := Setup(context.Background(), "internxt", form)
	if err != nil || q == nil || q.Name != "config_2fa" || len(q.Choices) != 0 {
		t.Fatalf("question = %+v, %v; want the code, typed in", q, err)
	}
	if said, _ := json.Marshal(q); !strings.Contains(string(said), `"choices":[]`) {
		t.Fatalf("the question reaches the page as %s, which a form cannot list", said)
	}

	form[q.Name] = "123456"
	got, q, err := Setup(context.Background(), "internxt", form)
	if err != nil || q != nil || got["mnemonic"] == "" {
		t.Fatalf("setup with the code = %v, %+v, %v", got, q, err)
	}
	if _, kept := got["config_2fa"]; kept {
		t.Fatal("the code was kept as a setting; it works once")
	}
}

func TestAWrongInternxtCodeIsRefusedInPlainWords(t *testing.T) {
	form := map[string]string{"email": "2fa@example.invalid", "pass": "right", "config_2fa": "000000"}
	_, _, err := Setup(context.Background(), "internxt", form)
	if err == nil || !strings.Contains(err.Error(), "Wrong 2-factor auth code") {
		t.Fatalf("setup = %v, want Internxt's refusal of the code", err)
	}
}

func TestTheInternxtTestAndSaveSignInOnce(t *testing.T) {
	internxtLogins = 0
	form := map[string]string{"email": "once@example.invalid", "pass": "right"}
	for range 2 {
		if _, _, err := Setup(context.Background(), "internxt", form); err != nil {
			t.Fatal(err)
		}
	}
	if internxtLogins != 1 {
		t.Fatalf("signed in %d times; a code typed for the test would be spent at the save", internxtLogins)
	}
}

func TestASavedInternxtTargetWhosePasswordIsUntouchedIsNotSignedInAgain(t *testing.T) {
	internxtLogins = 0
	form := map[string]string{"email": "me@example.invalid", "pass": Placeholder, "mnemonic": Placeholder, "token": Placeholder}
	got, q, err := Setup(context.Background(), "internxt", form)
	if err != nil || q != nil || internxtLogins != 0 {
		t.Fatalf("setup = %+v, %v after %d sign-ins", q, err, internxtLogins)
	}
	if got["mnemonic"] != Placeholder || got["token"] != Placeholder {
		t.Fatalf("settings = %v, want the saved ones kept", got)
	}
}
