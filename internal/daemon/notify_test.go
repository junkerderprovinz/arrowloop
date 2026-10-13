package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

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

// notifying reloads a runner with these notification settings.
func notifying(r *Runner, n job.Notify) {
	cfg := *r.config()
	cfg.Notify = n
	r.Reload(&cfg)
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
	notifying(r, job.Notify{
		Webhook: hook.url("/hook"), WebhookFormat: "discord",
		Apprise: &job.Apprise{URL: apprise.url("/notify/key")},
		Matrix:  &job.Matrix{Enabled: no(), Homeserver: room.url(""), Room: "!r:x", Token: "t"},
	})
	breakBefore(r)
	if _, err := r.Run(context.Background(), "test"); err == nil {
		t.Fatal("the run did not fail")
	}
	for name, in := range map[string]*inbox{"webhook": hook, "apprise": apprise} {
		if got := in.all(); len(got) != 1 || !strings.Contains(got[0], "test FAILED") {
			t.Errorf("%s got %v", name, got)
		}
	}
	if got := room.all(); len(got) != 0 {
		t.Errorf("a switched-off room was posted to: %v", got)
	}
}

func TestASuccessfulRunIsReportedOnlyWhenAskedFor(t *testing.T) {
	for _, tc := range []struct {
		name string
		n    job.Notify
		want int
	}{
		{"by default", job.Notify{}, 0},
		{"with on always", job.Notify{On: "always"}, 1},
		{"with the older onSuccess", job.Notify{OnSuccess: true}, 1},
		{"with on failure over onSuccess", job.Notify{On: "failure", OnSuccess: true}, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, _, _ := syncedPair(t)
			hook := newInbox(t)
			tc.n.Webhook = hook.url("/hook")
			notifying(r, tc.n)
			if _, err := r.Run(context.Background(), "test"); err != nil {
				t.Fatalf("run: %v", err)
			}
			if got := hook.all(); len(got) != tc.want {
				t.Errorf("got %d messages, want %d: %v", len(got), tc.want, got)
			}
		})
	}
}

func TestHealthchecksHearsTheStartAndTheOutcome(t *testing.T) {
	r, _, _ := syncedPair(t)
	hc := newInbox(t)
	notifying(r, job.Notify{Healthchecks: &job.Healthchecks{URL: hc.url("/all"), Jobs: map[string]string{"test": hc.url("/own")}}})

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
			cfg.Notify = job.Notify{Webhook: hook.url("/hook"), Healthchecks: &job.Healthchecks{URL: hc.url("/all")}}
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
			cfg.Notify = job.Notify{Webhook: hook.url("/hook")}
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
	notifying(r, job.Notify{On: "never", Webhook: hook.url("/hook"), Healthchecks: &job.Healthchecks{URL: hc.url("/all")}})

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
	notifying(r, job.Notify{
		On:           "always",
		Webhook:      refusing.url("/hook/SECRETHOOK"),
		Apprise:      &job.Apprise{URL: dead.URL + "/notify/SECRETKEY"},
		Healthchecks: &job.Healthchecks{URL: dead.URL + "/SECRETCHECK"},
	})

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

func TestATestMessageGoesToTheOneChannelAsked(t *testing.T) {
	hook, apprise, hc := newInbox(t), newInbox(t), newInbox(t)
	n := job.Notify{
		On:           "never",
		Webhook:      hook.url("/hook"),
		Apprise:      &job.Apprise{Enabled: no(), URL: apprise.url("/notify/key")},
		Healthchecks: &job.Healthchecks{URL: hc.url("/all"), Jobs: map[string]string{"photos": hc.url("/photos"), "music": hc.url("/all")}},
	}
	// A test is asked for while setting a channel up, which may be before it
	// is switched on and whatever the "when" says.
	if err := SendTest(context.Background(), n, "apprise"); err != nil {
		t.Fatalf("apprise: %v", err)
	}
	if got := append(hook.all(), hc.all()...); len(got) != 0 {
		t.Errorf("other channels heard the test: %v", got)
	}
	if got := apprise.all(); len(got) != 1 {
		t.Errorf("apprise got %v", got)
	}

	if err := SendTest(context.Background(), n, "healthchecks"); err != nil {
		t.Fatalf("healthchecks: %v", err)
	}
	if got := hc.all(); len(got) != 2 {
		t.Errorf("every distinct check should be pinged once: %v", got)
	}

	if err := SendTest(context.Background(), n, "smtp"); err == nil {
		t.Error("a test of a channel that is not filled in passed")
	}
	if err := SendTest(context.Background(), n, "pigeon"); err == nil {
		t.Error("a test of a channel that does not exist passed")
	}

	hook.mu.Lock()
	hook.code = http.StatusNotFound
	hook.mu.Unlock()
	if err := SendTest(context.Background(), n, "webhook"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("a refused test says %v", err)
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
			notifying(r, job.Notify{Webhook: hook.url("/hook"), Healthchecks: &job.Healthchecks{URL: hc.url("/check")}})
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

	n := job.Notify{
		On:           "always",
		Webhook:      hook.url("/hook"),
		Apprise:      &job.Apprise{URL: apprise.url("/notify/key")},
		Matrix:       &job.Matrix{Homeserver: room.url(""), Room: "!r:x", Token: "t"},
		SMTP:         &job.SMTP{Host: "127.0.0.1", Port: mail.Addr().(*net.TCPAddr).Port, From: "a@x", To: "b@x", TLS: "none"},
		Healthchecks: &job.Healthchecks{URL: hc.url("/all"), Jobs: map[string]string{"test": hc.url("/own")}},
	}
	stored, _ := json.Marshal(n)
	t.Setenv(NoChannelsEnv, "1")
	notifying(r, n)

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
	for _, channel := range []string{"webhook", "matrix", "smtp", "apprise", "healthchecks"} {
		if err := SendTest(context.Background(), n, channel); err == nil {
			t.Errorf("a test through %s went out", channel)
		}
	}

	if got := slices.Concat(hook.all(), apprise.all(), room.all(), hc.all()); len(got) != 0 {
		t.Errorf("the channels heard %v", got)
	}
	if got := dialled.Load(); got != 0 {
		t.Errorf("the mail server was dialled %d times", got)
	}
	if now, _ := json.Marshal(r.config().Notify); string(now) != string(stored) {
		t.Errorf("the settings changed from %s to %s", stored, now)
	}
}
