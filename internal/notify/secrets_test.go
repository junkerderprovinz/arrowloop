package notify

import (
	"encoding/json"
	"strings"
	"testing"

	kit "github.com/junkerderprovinz/parleyport/kit/notify"
)

// stored has a secret of every kind, each a word that must not leave the
// engine.
func stored() []kit.Channel {
	return []kit.Channel{
		{ID: "hook", Kind: kit.KindWebhook, Enabled: true, Webhook: &kit.Webhook{URL: "https://hooks.example/SECRETHOOK", Headers: map[string]string{"Authorization": "Bearer SECRETHEADER"}}},
		{ID: "discord", Kind: kit.KindDiscord, Enabled: true, Discord: &kit.Discord{URL: "https://discord.com/api/webhooks/1/SECRETDISCORD"}},
		{ID: "slack", Kind: kit.KindSlack, Enabled: true, Slack: &kit.Slack{URL: "https://hooks.slack.com/services/SECRETSLACK"}},
		{ID: "gotify", Kind: kit.KindGotify, Enabled: true, Gotify: &kit.Gotify{URL: "https://gotify.example/?token=SECRETGOTIFYURL", Token: "SECRETGOTIFY"}},
		{ID: "ntfy", Kind: kit.KindNtfy, Enabled: true, Ntfy: &kit.Ntfy{URL: "https://ntfy.sh/SECRETTOPIC", Token: "SECRETNTFY"}},
		{ID: "matrix", Kind: kit.KindMatrix, Enabled: true, Matrix: &kit.Matrix{Homeserver: "https://matrix.example.org", Room: "!a:example.org", Token: "SECRETMATRIX"}},
		{ID: "mail", Kind: kit.KindSMTP, Enabled: true, SMTP: &kit.SMTP{Host: "mail.example.org", Username: "arrowloop", Password: "SECRETPASSWORD", From: "a@example.org", To: "b@example.org"}},
		{ID: "apprise", Kind: kit.KindApprise, Enabled: true, Apprise: &kit.Apprise{URL: "http://apprise:8000/notify", URLs: []string{"tgram://SECRETTELEGRAM/123"}}},
		{ID: "appkey", Kind: kit.KindApprise, Enabled: true, Apprise: &kit.Apprise{URL: "http://apprise:8000/notify/SECRETKEY", Tags: "backups"}},
		{ID: "checks", Kind: kit.KindHealthchecks, Enabled: true, Healthchecks: &kit.Healthchecks{URL: "https://hc-ping.com/SECRETCHECK", ByKey: map[string]string{"photos": "https://hc-ping.com/SECRETJOBCHECK"}}},
	}
}

func TestRedactedHandsOutNoSecret(t *testing.T) {
	out, err := json.Marshal(Redacted(stored()))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), "SECRET") {
		t.Errorf("the channels carry a secret: %s", out)
	}
	for _, plain := range []string{"matrix.example.org", "mail.example.org", "arrowloop", "backups", `"photos"`, "Authorization"} {
		if !strings.Contains(string(out), plain) {
			t.Errorf("the channels lost %s: %s", plain, out)
		}
	}
}

func TestRedactedLeavesTheStoredChannelsAlone(t *testing.T) {
	s := stored()
	Redacted(s)
	if s[0].Webhook.URL != "https://hooks.example/SECRETHOOK" || s[9].Healthchecks.ByKey["photos"] == Placeholder {
		t.Errorf("redacting changed what is stored: %+v", s[0].Webhook)
	}
}

func TestWhatThePageSavesBackKeepsEverySecret(t *testing.T) {
	merged, err := Merge(Redacted(stored()), stored())
	if err != nil {
		t.Fatal(err)
	}
	want, _ := json.Marshal(stored())
	got, _ := json.Marshal(merged)
	if string(got) != string(want) {
		t.Errorf("the page's copy came back as\n%s\nwant\n%s", got, want)
	}
}

func TestANewSecretReplacesTheStoredOne(t *testing.T) {
	next := Redacted(stored())
	next[6].SMTP.Password = "newpw"
	next[9].Healthchecks.ByKey["music"] = "https://hc-ping.com/music"
	merged, err := Merge(next, stored())
	if err != nil {
		t.Fatal(err)
	}
	if merged[6].SMTP.Password != "newpw" || merged[9].Healthchecks.ByKey["music"] != "https://hc-ping.com/music" || merged[9].Healthchecks.ByKey["photos"] != "https://hc-ping.com/SECRETJOBCHECK" {
		t.Errorf("merged into %+v and %+v", merged[6].SMTP, merged[9].Healthchecks)
	}
}

// A placeholder stands for a secret saved for one server. Whoever changes the
// server beside it has to type the secret, or could have it sent to his own.
func TestASavedSecretIsNotMovedToAnotherServer(t *testing.T) {
	cases := map[string]func(c []kit.Channel){
		"matrix homeserver": func(c []kit.Channel) { c[5].Matrix.Homeserver = "https://elsewhere.example" },
		"mail host":         func(c []kit.Channel) { c[6].SMTP.Host = "elsewhere.example" },
		"mail port":         func(c []kit.Channel) { c[6].SMTP.Port = 2525 },
		"mail user":         func(c []kit.Channel) { c[6].SMTP.Username = "someone" },
		"mail encryption":   func(c []kit.Channel) { c[6].SMTP.TLS = "none" },
		"ntfy topic":        func(c []kit.Channel) { c[4].Ntfy.URL = "https://elsewhere.example/topic" },
		"webhook address":   func(c []kit.Channel) { c[0].Webhook.URL = "https://elsewhere.example/in" },
		"another kind":      func(c []kit.Channel) { c[5].Kind = kit.KindSlack; c[5].Slack = &kit.Slack{URL: Placeholder} },
	}
	for what, change := range cases {
		next := Redacted(stored())
		change(next)
		if _, err := Merge(next, stored()); err == nil || !strings.Contains(err.Error(), "type it again") {
			t.Errorf("a changed %s with the placeholder merged with %v", what, err)
		}
	}
}

func TestAPlaceholderWithNothingBehindItIsRefused(t *testing.T) {
	next := []kit.Channel{{ID: "new", Kind: kit.KindDiscord, Discord: &kit.Discord{URL: Placeholder}}}
	if _, err := Merge(next, stored()); err == nil {
		t.Error("a placeholder for a channel that was never saved was accepted")
	}
}
