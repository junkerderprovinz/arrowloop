package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/junkerderprovinz/parleyport/kit/notify"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// inbox records what reached a test server, in order.
type inbox struct {
	mu   sync.Mutex
	got  []string
	srv  *httptest.Server
	code int
}

func newInbox(t *testing.T) *inbox {
	t.Helper()
	in := &inbox{code: http.StatusOK}
	in.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		in.mu.Lock()
		in.got = append(in.got, r.URL.Path+" "+string(b))
		code := in.code
		in.mu.Unlock()
		w.WriteHeader(code)
	}))
	t.Cleanup(in.srv.Close)
	return in
}

func (in *inbox) all() []string {
	in.mu.Lock()
	defer in.mu.Unlock()
	return append([]string(nil), in.got...)
}

func (in *inbox) url(path string) string { return in.srv.URL + path }

// notifying reloads a runner with these channels.
func notifying(r *Runner, channels ...notify.Channel) {
	cfg := *r.config()
	cfg.Notify = job.Notify{Channels: channels}
	r.Reload(&cfg)
}

// slack is a channel that posts {"text": ...}, so what it said can be read
// off the request. One attempt keeps a refusal from waiting for retries.
func slack(id, url string, on notify.On) notify.Channel {
	return notify.Channel{ID: id, Kind: notify.KindSlack, Enabled: true, On: on, Attempts: 1, Slack: &notify.Slack{URL: url}}
}

func checks(url string, byKey map[string]string) notify.Channel {
	return notify.Channel{ID: "checks", Kind: notify.KindHealthchecks, Enabled: true, On: notify.OnAlways, Attempts: 1,
		Healthchecks: &notify.Healthchecks{URL: url, ByKey: byKey}}
}

func breakBefore(r *Runner) {
	cfg := *r.config()
	cfg.Jobs = append([]job.Job(nil), cfg.Jobs...)
	cfg.Jobs[0].Before = "exit 1"
	r.Reload(&cfg)
}

func yes() *bool { v := true; return &v }
func no() *bool  { v := false; return &v }

func TestAFailedRunReachesEveryChannelThatIsOn(t *testing.T) {
	r, _, _ := syncedPair(t)
	hook, apprise, room := newInbox(t), newInbox(t), newInbox(t)
	notifying(r,
		slack("hook", hook.url("/hook"), notify.OnFailure),
		notify.Channel{ID: "apprise", Kind: notify.KindApprise, Enabled: true, Attempts: 1, Apprise: &notify.Apprise{URL: apprise.url("/notify/key")}},
		notify.Channel{ID: "room", Kind: notify.KindMatrix, Enabled: false, Matrix: &notify.Matrix{Homeserver: room.url(""), Room: "!r:x", Token: "t"}},
	)
	breakBefore(r)
	if _, err := r.Run(context.Background(), "test"); err == nil {
		t.Fatal("the run did not fail")
	}
	for name, in := range map[string]*inbox{"slack": hook, "apprise": apprise} {
		if got := in.all(); len(got) != 1 || !strings.Contains(got[0], "test FAILED") {
			t.Errorf("%s got %v", name, got)
		}
	}
	if got := room.all(); len(got) != 0 {
		t.Errorf("a switched-off room was posted to: %v", got)
	}
}

func TestASuccessfulRunIsReportedOnlyWhereAskedFor(t *testing.T) {
	r, _, _ := syncedPair(t)
	failures, always, never := newInbox(t), newInbox(t), newInbox(t)
	notifying(r, slack("failures", failures.url("/f"), notify.OnFailure), slack("always", always.url("/a"), notify.OnAlways), slack("never", never.url("/n"), notify.OnNever))
	if _, err := r.Run(context.Background(), "test"); err != nil {
		t.Fatalf("run: %v", err)
	}
	if got := always.all(); len(got) != 1 || !strings.Contains(got[0], "test finished") {
		t.Errorf("the channel for every run got %v", got)
	}
	if got := append(failures.all(), never.all()...); len(got) != 0 {
		t.Errorf("a success reached %v", got)
	}
}

func TestHealthchecksHearsTheStartAndTheOutcome(t *testing.T) {
	r, _, _ := syncedPair(t)
	hc := newInbox(t)
	notifying(r, checks(hc.url("/all"), map[string]string{"test": hc.url("/own")}))

	if _, err := r.Run(context.Background(), "test"); err != nil {
		t.Fatalf("run: %v", err)
	}
	breakBefore(r)
	r.Run(context.Background(), "test")

	got := hc.all()
	if len(got) != 4 || got[0] != "/own/start " || !strings.HasPrefix(got[1], "/own 0 copied") || got[2] != "/own/start " || !strings.HasPrefix(got[3], "/own/fail ") {
		t.Fatalf("the pings were %q", got)
	}
	if !strings.Contains(got[3], "exit") {
		t.Errorf("the failed ping does not say why: %q", got[3])
	}
}

func TestAHeldJobIsToldUnlessThatWasSwitchedOff(t *testing.T) {
	for _, tc := range []struct {
		name string
		held *bool
		want int
	}{
		{"by default", nil, 1},
		{"switched off", no(), 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, left, _ := syncedPair(t)
			hook, hc := newInbox(t), newInbox(t)
			cfg := *r.config()
			cfg.Anomalies.NotifyHeld = tc.held
			cfg.Notify = job.Notify{Channels: []notify.Channel{slack("hook", hook.url("/hook"), notify.OnFailure), checks(hc.url("/all"), nil)}}
			r.Reload(&cfg)

			emptyOut(t, left, 30)
			held(t, r)

			got := hook.all()
			if len(got) != tc.want || tc.want == 1 && !strings.Contains(got[0], "test is held") {
				t.Errorf("the webhook got %v", got)
			}
			// The check started, so it has to end, or it shows a run that
			// hangs; a held job has not synced, which is a failure to the check.
			pings := hc.all()
			if len(pings) != 2 || !strings.HasPrefix(pings[1], "/all/fail ") {
				t.Errorf("the check got %q", pings)
			}
		})
	}
}

func TestAnUnusualRunIsToldWhenNotesAreSent(t *testing.T) {
	for _, tc := range []struct {
		name  string
		notes *bool
		want  int
	}{
		{"by default", nil, 0},
		{"with notes on", yes(), 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, _, _ := syncedPair(t)
			hook := newInbox(t)
			cfg := *r.config()
			cfg.Anomalies.NotifyNotes = tc.notes
			cfg.Notify = job.Notify{Channels: []notify.Channel{slack("hook", hook.url("/hook"), notify.OnFailure)}}
			r.Reload(&cfg)
			learned(t, r)

			r.review(context.Background(), unusualRun(412))
			got := hook.all()
			if len(got) != tc.want || tc.want == 1 && !strings.Contains(got[0], "a note about test") {
				t.Errorf("the webhook got %v", got)
			}
		})
	}
}

func TestNeverSendsNothingAtAll(t *testing.T) {
	r, left, _ := syncedPair(t)
	hook, hc := newInbox(t), newInbox(t)
	quiet := checks(hc.url("/all"), nil)
	quiet.On = notify.OnNever
	notifying(r, slack("hook", hook.url("/hook"), notify.OnNever), quiet)

	emptyOut(t, left, 30)
	held(t, r)
	breakBefore(r)
	r.Run(context.Background(), "test")

	if got := append(hook.all(), hc.all()...); len(got) != 0 {
		t.Errorf("never still sent %v", got)
	}
}

func TestAMessageThatCannotBeDeliveredLeavesTheRunAlone(t *testing.T) {
	r, _, _ := syncedPair(t)
	var mu sync.Mutex
	var logged []string
	r.log = func(format string, args ...any) {
		mu.Lock()
		logged = append(logged, fmt.Sprintf(format, args...))
		mu.Unlock()
	}
	refusing := newInbox(t)
	refusing.code = http.StatusInternalServerError
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close()
	notifying(r,
		slack("hook", refusing.url("/hook/SECRETHOOK"), notify.OnAlways),
		notify.Channel{ID: "apprise", Kind: notify.KindApprise, Enabled: true, On: notify.OnAlways, Attempts: 1, Apprise: &notify.Apprise{URL: dead.URL + "/notify/SECRETKEY"}},
		checks(dead.URL+"/SECRETCHECK", nil),
	)

	if _, err := r.Run(context.Background(), "test"); err != nil {
		t.Fatalf("a refused message failed the run: %v", err)
	}
	mu.Lock()
	text := strings.Join(logged, "\n")
	mu.Unlock()
	if !strings.Contains(text, "500") {
		t.Errorf("the refusal was not logged: %s", text)
	}
	for _, secret := range []string{"SECRETHOOK", "SECRETKEY", "SECRETCHECK"} {
		if strings.Contains(text, secret) {
			t.Errorf("the log carries %s: %s", secret, text)
		}
	}
}

func TestAChannelSwitchedOnButIncompleteIsNamedInTheLog(t *testing.T) {
	r, _, _ := syncedPair(t)
	var logged []string
	r.log = func(format string, args ...any) { logged = append(logged, fmt.Sprintf(format, args...)) }
	half := slack("half", "htt", notify.OnAlways)
	half.Name = "Kitchen"
	hook := newInbox(t)
	notifying(r, half, slack("hook", hook.url("/hook"), notify.OnAlways))

	if !strings.Contains(strings.Join(logged, "\n"), "Kitchen") {
		t.Errorf("the log does not name the channel: %v", logged)
	}
	if _, err := r.Run(context.Background(), "test"); err != nil {
		t.Fatalf("run: %v", err)
	}
	if got := hook.all(); len(got) != 1 {
		t.Errorf("one incomplete channel kept the others quiet: %v", got)
	}
}

func TestATestMessageGoesToTheOneChannelAsked(t *testing.T) {
	apprise, hc := newInbox(t), newInbox(t)
	// A test is asked for while setting a channel up, which may be before it
	// is switched on and whatever its "when" says.
	off := notify.Channel{ID: "apprise", Kind: notify.KindApprise, Enabled: false, On: notify.OnNever, Apprise: &notify.Apprise{URL: apprise.url("/notify/key")}}
	if res := SendTest(context.Background(), off); !res.OK() {
		t.Fatalf("apprise: %v", res.Err)
	}
	if got := apprise.all(); len(got) != 1 {
		t.Errorf("apprise got %v", got)
	}

	if res := SendTest(context.Background(), checks(hc.url("/all"), map[string]string{"photos": hc.url("/photos"), "music": hc.url("/all")})); !res.OK() {
		t.Fatalf("healthchecks: %v", res.Err)
	}
	if got := hc.all(); len(got) != 2 {
		t.Errorf("every distinct check should be pinged once: %v", got)
	}

	if res := SendTest(context.Background(), notify.Channel{ID: "mail", Kind: notify.KindSMTP}); res.OK() || res.Code != notify.CodeInvalid {
		t.Errorf("a test of a channel that is not filled in answered %+v", res)
	}

	gone := newInbox(t)
	gone.code = http.StatusNotFound
	if res := SendTest(context.Background(), slack("hook", gone.url("/hook"), notify.OnNever)); res.OK() || res.Status != http.StatusNotFound {
		t.Errorf("a refused test answered %+v", res)
	}
}

// A message leaves the machine, so what a run's error quotes of a connection
// string or of a hook's output stays behind, as it does in the bug report.
func TestAMessageCarriesNoPasswordFromTheRunsError(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(j *job.Job)
		secret []string
		keep   string
	}{
		{"a connection string", func(j *job.Job) { j.Right = ":sftp,host=127.0.0.1,port=1,user=bob,pass=TOPSECRETPASS:/x" },
			[]string{"TOPSECRETPASS", "user=bob"}, ":sftp:/x"},
		{"a hook's output", func(j *job.Job) { j.Before = "echo HOOKSECRET && exit 3" },
			[]string{"HOOKSECRET"}, "exit status 3"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, _, _ := syncedPair(t)
			hook, hc := newInbox(t), newInbox(t)
			notifying(r, slack("hook", hook.url("/hook"), notify.OnFailure), checks(hc.url("/check"), nil))
			cfg := *r.config()
			cfg.Jobs = append([]job.Job(nil), cfg.Jobs...)
			tc.change(&cfg.Jobs[0])
			r.Reload(&cfg)
			if _, err := r.Run(context.Background(), "test"); err == nil {
				t.Fatal("the run did not fail")
			}
			sent := strings.Join(append(hook.all(), hc.all()...), "\n")
			for _, secret := range tc.secret {
				if strings.Contains(sent, secret) {
					t.Errorf("a message carries %s:\n%s", secret, sent)
				}
			}
			if !strings.Contains(sent, tc.keep) {
				t.Errorf("the messages lost %q:\n%s", tc.keep, sent)
			}
		})
	}
}

func TestNoChannelsKeepsEveryChannelQuietAndLeavesTheSettings(t *testing.T) {
	r, left, _ := syncedPair(t)
	hook, apprise, room, hc := newInbox(t), newInbox(t), newInbox(t), newInbox(t)
	mail, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { mail.Close() })
	var dialled atomic.Int32
	go func() {
		for {
			conn, err := mail.Accept()
			if err != nil {
				return
			}
			dialled.Add(1)
			conn.Close()
		}
	}()

	channels := []notify.Channel{
		slack("hook", hook.url("/hook"), notify.OnAlways),
		{ID: "apprise", Kind: notify.KindApprise, Enabled: true, On: notify.OnAlways, Apprise: &notify.Apprise{URL: apprise.url("/notify/key")}},
		{ID: "room", Kind: notify.KindMatrix, Enabled: true, On: notify.OnAlways, Matrix: &notify.Matrix{Homeserver: room.url(""), Room: "!r:x", Token: "t"}},
		{ID: "mail", Kind: notify.KindSMTP, Enabled: true, On: notify.OnAlways, SMTP: &notify.SMTP{Host: "127.0.0.1", Port: mail.Addr().(*net.TCPAddr).Port, From: "a@x", To: "b@x", TLS: "none"}},
		checks(hc.url("/all"), map[string]string{"test": hc.url("/own")}),
	}
	stored, _ := json.Marshal(channels)
	t.Setenv(NoChannelsEnv, "1")
	notifying(r, channels...)

	if _, err := r.Run(context.Background(), "test"); err != nil {
		t.Fatalf("run: %v", err)
	}
	emptyOut(t, left, 30)
	held(t, r)
	if told := r.drainTold(); len(told) != 1 || !told[0].Held {
		t.Errorf("the phone's own notification lost the held job: %+v", told)
	}
	breakBefore(r)
	r.Run(context.Background(), "test")
	for _, c := range channels {
		if res := SendTest(context.Background(), c); res.OK() || res.Code != CodeOff {
			t.Errorf("a test through %s answered %+v", c.ID, res)
		}
	}

	if got := slices.Concat(hook.all(), apprise.all(), room.all(), hc.all()); len(got) != 0 {
		t.Errorf("the channels heard %v", got)
	}
	if got := dialled.Load(); got != 0 {
		t.Errorf("the mail server was dialled %d times", got)
	}
	if now, _ := json.Marshal(r.config().Notify.Channels); string(now) != string(stored) {
		t.Errorf("the settings changed from %s to %s", stored, now)
	}
}

func TestTheMessageSaysDeletedForAJobWithoutATrash(t *testing.T) {
	for _, tc := range []struct {
		name    string
		noTrash bool
		want    string
	}{
		{"with the trash", false, "1 trashed"},
		{"without the trash", true, "1 deleted"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, left, _ := syncedPair(t)
			hook := newInbox(t)
			cfg := *r.config()
			cfg.Jobs = append([]job.Job(nil), cfg.Jobs...)
			cfg.Jobs[0].NoTrash = tc.noTrash
			cfg.Notify = job.Notify{Channels: []notify.Channel{slack("hook", hook.url("/hook"), notify.OnAlways)}}
			r.Reload(&cfg)
			if err := os.Remove(filepath.Join(left, "datei-00.txt")); err != nil {
				t.Fatal(err)
			}

			rec, err := r.Run(context.Background(), "test")
			if err != nil {
				t.Fatalf("run: %v", err)
			}
			if rec.Trashed != 1 || rec.NoTrash != tc.noTrash {
				t.Errorf("the run reads %+v", rec)
			}
			got := hook.all()
			if len(got) != 1 || !strings.Contains(got[0], tc.want) {
				t.Errorf("the webhook got %v, want it to say %q", got, tc.want)
			}
		})
	}
}
