package remotes

import (
	"context"
	"errors"
	"strings"
	"testing"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configmap"
	"github.com/rclone/rclone/lib/oauthutil"
)

// The fakes walk the states of rclone's Jottacloud and OneDrive setups with
// the same questions, so the real steps answer them without the network.

var trades int

var fakes = map[string]*rclonefs.RegInfo{
	"fakejotta": {
		Name:    "fakejotta",
		Options: []rclonefs.Option{{Name: "token"}, {Name: "client_id"}},
		Config: func(_ context.Context, _ string, m configmap.Mapper, in rclonefs.ConfigIn) (*rclonefs.ConfigOut, error) {
			switch in.State {
			case "":
				return rclonefs.ConfigChooseExclusiveFixed("auth_type_done", "config_type", "Type of authentication.",
					[]rclonefs.OptionExample{{Value: "standard"}, {Value: "traditional"}})
			case "auth_type_done":
				return rclonefs.ConfigGoto(in.Result)
			case "standard":
				return rclonefs.ConfigInput("standard_token", "config_login_token", "Personal login token.")
			case "standard_token":
				if in.Result != "LOGIN" {
					return nil, errors.New("failed to get oauth token: used up")
				}
				trades++
				m.Set("token", `{"access_token":"for-LOGIN"}`)
				m.Set("client_id", "jottacli")
				return rclonefs.ConfigGoto("choose_device")
			case "choose_device":
				return rclonefs.ConfigConfirm("choose_device_query", false, "config_non_standard", "Use a non-standard device?")
			}
			return nil, nil
		},
	},
	"fakeonedrive": {
		Name:    "fakeonedrive",
		Options: []rclonefs.Option{{Name: "token"}, {Name: "drive_id"}, {Name: "drive_type"}},
		Config: func(_ context.Context, _ string, m configmap.Mapper, in rclonefs.ConfigIn) (*rclonefs.ConfigOut, error) {
			switch in.State {
			case "":
				return oauthutil.ConfigOut("choose_type", &oauthutil.Options{OAuth2Config: &oauthutil.Config{}})
			case "choose_type":
				return rclonefs.ConfigChooseExclusiveFixed("choose_type_done", "config_type", "Type of connection",
					[]rclonefs.OptionExample{{Value: "onedrive"}, {Value: "sharepoint"}})
			case "choose_type_done":
				return rclonefs.ConfigGoto(in.Result)
			case "onedrive":
				drives := []string{"personal-drive"}
				if token, _ := m.Get("token"); strings.Contains(token, "team") {
					drives = append(drives, "team-drive")
				}
				return rclonefs.ConfigChoose("driveid_final", "config_driveid", "Choose drive", len(drives), func(i int) (string, string) {
					return drives[i], "Drive " + drives[i]
				})
			case "driveid_final":
				m.Set("drive_id", in.Result)
				m.Set("drive_type", "business")
				return rclonefs.ConfigConfirm("driveid_final_end", true, "config_drive_ok", "Drive OK?")
			}
			return nil, nil
		},
	},
}

func init() {
	findBackend = func(name string) (*rclonefs.RegInfo, error) {
		if fake, ok := fakes[name]; ok {
			return fake, nil
		}
		return rclonefs.Find(name)
	}
	setupSteps["fakejotta"] = setupSteps["jottacloud"]
	setupSteps["fakeonedrive"] = setupSteps["onedrive"]
}

func TestJottacloudTradesItsLoginTokenOnceForTheTestAndTheSave(t *testing.T) {
	trades = 0
	form := map[string]string{"token": "LOGIN"}
	for range 2 {
		got, q, err := Setup(context.Background(), "fakejotta", form)
		if err != nil || q != nil {
			t.Fatalf("setup = %v, %v", q, err)
		}
		if got["token"] != `{"access_token":"for-LOGIN"}` || got["client_id"] != "jottacli" {
			t.Fatalf("settings = %v, want what the login token was traded for", got)
		}
		for k := range got {
			if strings.HasPrefix(k, "config_") {
				t.Errorf("the setup's own input %s became a setting", k)
			}
		}
	}
	if trades != 1 {
		t.Fatalf("the login token was traded %d times; it works once", trades)
	}
}

func TestAJottacloudTokenThatIsAlreadyASignInIsLeftAlone(t *testing.T) {
	trades = 0
	for _, token := range []string{`{"access_token":"a"}`, Placeholder} {
		got, _, err := Setup(context.Background(), "fakejotta", map[string]string{"token": token})
		if err != nil || got["token"] != token || trades != 0 {
			t.Fatalf("token %q came back as %v, %v after %d trades", token, got, err, trades)
		}
	}
}

func TestOneDriveAsksWhichDriveWhenTheSignInOpensSeveral(t *testing.T) {
	form := map[string]string{"token": `{"access_token":"team"}`}
	_, q, err := Setup(context.Background(), "fakeonedrive", form)
	if err != nil || q == nil || q.Name != "config_driveid" || len(q.Choices) != 2 {
		t.Fatalf("question = %+v, %v; want which of two drives", q, err)
	}

	form[q.Name] = "team-drive"
	got, q, err := Setup(context.Background(), "fakeonedrive", form)
	if err != nil || q != nil {
		t.Fatalf("setup with the drive picked = %+v, %v", q, err)
	}
	if got["drive_id"] != "team-drive" || got["drive_type"] != "business" {
		t.Fatalf("settings = %v, want the drive picked", got)
	}
	if _, kept := got["config_driveid"]; kept {
		t.Fatal("the answer to the question was kept as a setting")
	}
}

func TestOneDriveTakesItsOnlyDriveWithoutAsking(t *testing.T) {
	got, q, err := Setup(context.Background(), "fakeonedrive", map[string]string{"token": `{"access_token":"me"}`})
	if err != nil || q != nil || got["drive_id"] != "personal-drive" {
		t.Fatalf("setup = %v, %+v, %v; want the one drive", got, q, err)
	}
}

func TestAConfigBlobFromRcloneAuthorizeFillsTheFormItCameFrom(t *testing.T) {
	blob, _ := configmap.Simple{
		"token":    `{"access_token":"a"}`,
		"region":   "eu",
		"endpoint": "https://acme.sf-api.com",
	}.Encode()
	got, _, err := Setup(context.Background(), "sharefile", map[string]string{"token": blob, "region": "com"})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"token": `{"access_token":"a"}`, "region": "com", "endpoint": "https://acme.sf-api.com"}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
}

func TestATokenThatIsNoConfigBlobStaysAsTyped(t *testing.T) {
	// A Jottacloud login token is base64 JSON too, without a token in it.
	login, _ := configmap.Simple{"username": "me", "auth_token": "x"}.Encode()
	for _, token := range []string{`{"access_token":"a"}`, login, "plain api token"} {
		got, _, _ := Setup(context.Background(), "sharefile", map[string]string{"token": token})
		if got["token"] != token || len(got) != 1 {
			t.Errorf("token %q became %v", token, got)
		}
	}
}
