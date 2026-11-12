package job

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/junkerderprovinz/parleyport/kit/notify"
)

func notifyFrom(t *testing.T, n string) Notify {
	t.Helper()
	cfg, err := Load(writeConfig(t, `{"jobs":[],"notify":`+n+`}`))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	return cfg.Notify
}

// beforeChannels is what a file from before the channel list holds, each
// service in a block of its own, as testdata/notify-before-channels.json
// has it.
var beforeChannels = []notify.Channel{
	{ID: "matrix", Kind: notify.KindMatrix, Enabled: true, On: notify.OnAlways,
		Matrix: &notify.Matrix{Homeserver: "https://matrix.example.org", Room: "!room:example.org", Token: "syt_example"}},
	{ID: "webhook", Kind: notify.KindDiscord, Enabled: true, On: notify.OnAlways,
		Discord: &notify.Discord{URL: "https://discord.com/api/webhooks/123/example"}},
	{ID: "smtp", Kind: notify.KindSMTP, Enabled: false, On: notify.OnAlways,
		SMTP: &notify.SMTP{Host: "mail.example.org", Port: 465, TLS: "tls", Username: "arrowloop", Password: "example-password", From: "arrowloop@example.org", To: "me@example.org; you@example.org"}},
	{ID: "apprise", Kind: notify.KindApprise, Enabled: true, On: notify.OnAlways,
		Apprise: &notify.Apprise{URL: "http://apprise:8000/notify/example", Tags: "backups"}},
	{ID: "healthchecks", Kind: notify.KindHealthchecks, Enabled: true, On: notify.OnAlways,
		Healthchecks: &notify.Healthchecks{URL: "https://hc-ping.com/every-job", ByKey: map[string]string{"photos": "https://hc-ping.com/photos"}}},
}

func sameChannels(t *testing.T, got, want []notify.Channel) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d channels, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if !reflect.DeepEqual(got[i], want[i]) {
			g, _ := json.Marshal(got[i])
			w, _ := json.Marshal(want[i])
			t.Errorf("channel %d is\n%s\nwant\n%s", i, g, w)
		}
	}
}

func TestAFileFromBeforeTheChannelsKeepsEveryChannel(t *testing.T) {
	old, err := os.ReadFile(filepath.Join("testdata", "notify-before-channels.json"))
	if err != nil {
		t.Fatal(err)
	}
	path := writeConfig(t, string(old))

	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	sameChannels(t, cfg.Notify.Channels, beforeChannels)

	// The channels are written to the file, and the older keys stay beside
	// them, so going back a version loses nothing either.
	var doc struct {
		Notify map[string]json.RawMessage `json:"notify"`
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"channels", "matrix", "webhook", "smtp", "apprise", "healthchecks", "on"} {
		if _, ok := doc.Notify[key]; !ok {
			t.Errorf("the file has no notify.%s after the load: %s", key, raw)
		}
	}

	again, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	sameChannels(t, again.Notify.Channels, beforeChannels)
}

// The kit reads the older file as this app meant it: onSuccess said always,
// and never kept Healthchecks quiet too.
func TestTheOlderWhenKeepsItsMeaning(t *testing.T) {
	n := notifyFrom(t, `{"webhook":"https://hooks.example/abc","onSuccess":true}`)
	if len(n.Channels) != 1 || n.Channels[0].On != notify.OnAlways {
		t.Errorf("onSuccess became %+v", n.Channels)
	}
	n = notifyFrom(t, `{"on":"never","healthchecks":{"url":"https://hc-ping.com/all"}}`)
	if len(n.Channels) != 1 || n.Channels[0].On != notify.OnNever {
		t.Errorf("never became %+v", n.Channels)
	}
	n = notifyFrom(t, `{"healthchecks":{"url":"https://hc-ping.com/all"}}`)
	if n.Channels[0].On != notify.OnAlways {
		t.Errorf("Healthchecks pings %s, but it pinged every run", n.Channels[0].On)
	}
}

func TestOnceThereAreChannelsTheOlderKeysAreIgnored(t *testing.T) {
	n := notifyFrom(t, `{"channels":[{"id":"phone","kind":"ntfy","enabled":true,"ntfy":{"url":"https://ntfy.example/topic"}}],"webhook":"https://hooks.example/old"}`)
	if len(n.Channels) != 1 || n.Channels[0].ID != "phone" {
		t.Errorf("the channels are %+v", n.Channels)
	}
}

func TestAnEmptyChannelListStaysEmpty(t *testing.T) {
	if n := notifyFrom(t, `{"channels":[],"webhook":"https://hooks.example/old"}`); len(n.Channels) != 0 {
		t.Errorf("a list emptied by hand came back as %+v", n.Channels)
	}
}

// A channel being filled in is saved switched on while its address is half
// typed; it stays quiet rather than stopping the next start.
func TestAHalfFilledChannelDoesNotStopTheLoad(t *testing.T) {
	n := notifyFrom(t, `{"channels":[{"id":"a","kind":"discord","enabled":true,"discord":{"url":"htt"}}]}`)
	if len(n.Channels) != 1 {
		t.Fatalf("the channel was dropped: %+v", n.Channels)
	}
}

func TestLoadRefusesAChannelListItCannotRead(t *testing.T) {
	for _, tc := range []struct{ name, channels, want string }{
		{"an unknown service", `[{"id":"a","kind":"teams"}]`, "unknown_kind"},
		{"two channels with one id", `[{"id":"a","kind":"slack"},{"id":"a","kind":"discord"}]`, "duplicate_id"},
		{"an unknown when", `[{"id":"a","kind":"slack","on":"sometimes"}]`, "bad_on"},
		{"a misspelt setting", `[{"id":"a","kind":"slack","slak":{"url":"https://x.example"}}]`, "slak"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Load(writeConfig(t, `{"jobs":[],"notify":{"channels":`+tc.channels+`}}`))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want one naming %q", err, tc.want)
			}
		})
	}
}
