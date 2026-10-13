package job

import (
	"strings"
	"testing"
)

func notifyFrom(t *testing.T, notify string) Notify {
	t.Helper()
	cfg, err := Load(writeConfig(t, `{"jobs":[],"notify":`+notify+`}`))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	return cfg.Notify
}

// A file written before "on" existed says the same with onSuccess, and has to
// keep meaning what it meant.
func TestAnOlderFileKeepsItsChannelsAndItsChoice(t *testing.T) {
	n := notifyFrom(t, `{"webhook":"https://hooks.example/abc","matrix":{"homeserver":"https://m.example","room":"!r:m.example","token":"syt"}}`)
	if n.When() != "failure" || !n.Reports(true) || n.Reports(false) {
		t.Errorf("without onSuccess the file reported %q", n.When())
	}
	if !n.WebhookOn() || !n.Matrix.On() {
		t.Errorf("a filled-in channel with no switch was off: webhook %v, matrix %v", n.WebhookOn(), n.Matrix.On())
	}

	n = notifyFrom(t, `{"webhook":"https://hooks.example/abc","onSuccess":true}`)
	if n.When() != "always" || !n.Reports(false) {
		t.Errorf("onSuccess no longer reports a successful run: %q", n.When())
	}
}

func TestOnDecidesOverOnSuccess(t *testing.T) {
	n := notifyFrom(t, `{"on":"never","onSuccess":true}`)
	if n.Reports(true) || n.Reports(false) || !n.Silent() {
		t.Error("never still reports")
	}
	n = notifyFrom(t, `{"on":"failure","onSuccess":true}`)
	if n.Reports(false) || !n.Reports(true) {
		t.Error("failure reports a successful run")
	}
}

func TestASwitchedOffChannelKeepsItsSettings(t *testing.T) {
	n := notifyFrom(t, `{
	  "webhook":"https://hooks.example/abc","webhookEnabled":false,
	  "matrix":{"enabled":false,"homeserver":"https://m.example","room":"!r:m.example","token":"syt"},
	  "smtp":{"enabled":false,"host":"mail.example","from":"a@example.org","to":"b@example.org","password":"pw"},
	  "apprise":{"enabled":false,"url":"http://apprise:8000/notify/key"},
	  "healthchecks":{"enabled":false,"url":"https://hc-ping.com/uuid"}
	}`)
	if n.WebhookOn() || n.Matrix.On() || n.SMTP.On() || n.Apprise.On() {
		t.Error("a channel switched off still sends")
	}
	if n.CheckFor("photos") != "" {
		t.Error("switched-off Healthchecks still pings")
	}
	if n.Webhook == "" || n.Matrix.Token == "" || n.SMTP.Password == "" || n.Apprise.URL == "" || n.Healthchecks.URL == "" {
		t.Error("switching a channel off lost its settings")
	}
}

func TestAHalfFilledChannelSendsNothing(t *testing.T) {
	n := notifyFrom(t, `{"smtp":{"host":"mail.example","from":"a@example.org"},"matrix":{"homeserver":"https://m.example","room":"","token":""}}`)
	if n.SMTP.On() {
		t.Error("mail with no recipient counts as on")
	}
	if n.Matrix.On() {
		t.Error("Matrix with no room counts as on")
	}
	var none *SMTP
	if none.On() {
		t.Error("a missing channel counts as on")
	}
}

func TestAJobsOwnCheckReplacesTheSharedOne(t *testing.T) {
	n := notifyFrom(t, `{"healthchecks":{"url":"https://hc-ping.com/all","jobs":{"photos":"https://hc-ping.com/photos","music":""}}}`)
	if got := n.CheckFor("photos"); got != "https://hc-ping.com/photos" {
		t.Errorf("photos pings %q", got)
	}
	if got := n.CheckFor("music"); got != "https://hc-ping.com/all" {
		t.Errorf("an empty entry pings %q instead of the shared check", got)
	}
	if got := n.CheckFor("documents"); got != "https://hc-ping.com/all" {
		t.Errorf("a job without its own check pings %q", got)
	}

	never := notifyFrom(t, `{"on":"never","healthchecks":{"url":"https://hc-ping.com/all"}}`)
	if never.CheckFor("photos") != "" {
		t.Error("never still pings Healthchecks")
	}
}

func TestLoadRefusesANotificationSettingItCannotRead(t *testing.T) {
	for _, tc := range []struct{ name, notify, want string }{
		{"an unknown when", `{"on":"sometimes"}`, "sometimes"},
		{"an unknown webhook format", `{"webhook":"https://x.example","webhookFormat":"teams"}`, "teams"},
		{"an unknown mail encryption", `{"smtp":{"host":"m","from":"a@b","to":"c@d","tls":"ssl3"}}`, "ssl3"},
		{"a port out of range", `{"smtp":{"host":"m","from":"a@b","to":"c@d","port":70000}}`, "70000"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Load(writeConfig(t, `{"jobs":[],"notify":`+tc.notify+`}`))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want one naming %q", err, tc.want)
			}
		})
	}
}
