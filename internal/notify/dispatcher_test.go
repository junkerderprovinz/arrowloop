package notify

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	kit "github.com/junkerderprovinz/parleyport/kit/notify"
)

// target is a server a generic Shoutrrr address posts to. It records every
// body and answers each path with the status set for it, else 200.
type target struct {
	mu     sync.Mutex
	got    map[string][]string
	status map[string]int
	srv    *httptest.Server
}

func newTarget(t *testing.T) *target {
	t.Helper()
	tg := &target{got: map[string][]string{}, status: map[string]int{}}
	tg.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		tg.mu.Lock()
		tg.got[r.URL.Path] = append(tg.got[r.URL.Path], string(b))
		code := tg.status[r.URL.Path]
		tg.mu.Unlock()
		if code != 0 {
			w.WriteHeader(code)
		}
	}))
	t.Cleanup(tg.srv.Close)
	return tg
}

// address is a generic Shoutrrr address that posts the title and the message
// as JSON to path.
func (tg *target) address(path string) string {
	return "generic+" + tg.srv.URL + path + "?template=json"
}

func (tg *target) bodies(path string) []string {
	tg.mu.Lock()
	defer tg.mu.Unlock()
	return append([]string(nil), tg.got[path]...)
}

func shoutrrr(id string, on kit.On, urls ...string) Channel {
	return Channel{Channel: kit.Channel{ID: id, Kind: KindShoutrrr, Enabled: true, On: on, Attempts: 1}, Shoutrrr: &Shoutrrr{URLs: urls}}
}

var failed = kit.Event{Kind: "run.failed", Severity: kit.SeverityFailure, Title: "ArrowLoop: photos FAILED", Body: "2 copied, 1 conflict"}

func TestAShoutrrrAddressGetsTheTitleAndTheMessage(t *testing.T) {
	tg := newTarget(t)
	d, err := NewDispatcher([]Channel{shoutrrr("shout", kit.OnFailure, tg.address("/hook"))}, kit.Options{Source: "ArrowLoop"})
	if err != nil {
		t.Fatal(err)
	}
	results := d.Send(context.Background(), failed)
	if len(results) != 1 || !results[0].OK() || results[0].Kind != KindShoutrrr {
		t.Fatalf("the send came back as %+v", results)
	}
	got := tg.bodies("/hook")
	if len(got) != 1 {
		t.Fatalf("the target got %v", got)
	}
	var sent map[string]string
	if err := json.Unmarshal([]byte(got[0]), &sent); err != nil {
		t.Fatalf("the target got %q: %v", got[0], err)
	}
	if sent["title"] != failed.Title || sent["message"] != failed.Body {
		t.Errorf("the target got %v", sent)
	}
}

func TestAShoutrrrChannelSendsBesideTheKitsChannels(t *testing.T) {
	tg := newTarget(t)
	slack := Channel{Channel: kit.Channel{ID: "slack", Kind: kit.KindSlack, Enabled: true, Attempts: 1, Slack: &kit.Slack{URL: tg.srv.URL + "/slack"}}}
	d, err := NewDispatcher([]Channel{slack, shoutrrr("shout", kit.OnFailure, tg.address("/hook"))}, kit.Options{})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range d.Send(context.Background(), failed) {
		if !r.OK() {
			t.Errorf("%s failed: %v", r.Channel, r.Err)
		}
	}
	if len(tg.bodies("/slack")) != 1 || len(tg.bodies("/hook")) != 1 {
		t.Errorf("slack got %v, shoutrrr got %v", tg.bodies("/slack"), tg.bodies("/hook"))
	}
}

func TestAShoutrrrChannelTakesWhatItsWhenAndEventsAskFor(t *testing.T) {
	tg := newTarget(t)
	picky := shoutrrr("picky", kit.OnAlways, tg.address("/picky"))
	picky.Events = []string{"job.held"}
	d, err := NewDispatcher([]Channel{
		shoutrrr("failures", kit.OnFailure, tg.address("/failures")),
		shoutrrr("always", kit.OnAlways, tg.address("/always")),
		shoutrrr("never", kit.OnNever, tg.address("/never")),
		picky,
	}, kit.Options{})
	if err != nil {
		t.Fatal(err)
	}
	d.Send(context.Background(), kit.Event{Kind: "run.done", Severity: kit.SeveritySuccess, Title: "done", Body: "fine"})
	d.Send(context.Background(), failed)
	want := map[string]int{"/failures": 1, "/always": 2, "/never": 0, "/picky": 0}
	for path, n := range want {
		if got := tg.bodies(path); len(got) != n {
			t.Errorf("%s got %d messages, want %d", path, len(got), n)
		}
	}
}

func TestAnotherTryGoesOnlyToTheAddressThatFailed(t *testing.T) {
	tg := newTarget(t)
	tg.status["/down"] = http.StatusBadGateway
	c := shoutrrr("shout", kit.OnFailure, tg.address("/up"), tg.address("/down"))
	c.Attempts = 3
	d, err := NewDispatcher([]Channel{c}, kit.Options{})
	if err != nil {
		t.Fatal(err)
	}
	d.sleep = func(context.Context, time.Duration) bool { return true }
	r := d.Send(context.Background(), failed)[0]
	if r.OK() || r.Attempts != 3 || r.Code != kit.CodeRejected {
		t.Errorf("the send came back as %+v", r)
	}
	if up, down := len(tg.bodies("/up")), len(tg.bodies("/down")); up != 1 || down != 3 {
		t.Errorf("the working address got %d, the failing one %d", up, down)
	}
}

func TestAShoutrrrFailureQuotesNoSecret(t *testing.T) {
	gone := httptest.NewServer(http.NotFoundHandler())
	gone.Close()
	c := shoutrrr("shout", kit.OnFailure,
		"generic+"+gone.URL+"/SECRETLONGPATH?token=SECRETTOKEN",
		"generic+http://SECRETUSER:SECRETPASS@"+strings.TrimPrefix(gone.URL, "http://")+"/hook")
	r := (&Dispatcher{sleep: sleep}).Test(context.Background(), c, failed)
	if r.OK() {
		t.Fatal("a send to nowhere went through")
	}
	if strings.Contains(r.Err.Error(), "SECRET") {
		t.Errorf("the failure quotes a secret: %v", r.Err)
	}
	if r.Code != kit.CodeRefused {
		t.Errorf("the failure came back as %s: %v", r.Code, r.Err)
	}
}

func TestATestReachesAChannelThatIsOff(t *testing.T) {
	tg := newTarget(t)
	c := shoutrrr("shout", kit.OnNever, tg.address("/hook"))
	c.Enabled = false
	d, err := NewDispatcher(nil, kit.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if r := d.Test(context.Background(), c, failed); !r.OK() || len(tg.bodies("/hook")) != 1 {
		t.Errorf("the test came back as %+v, the target got %v", r, tg.bodies("/hook"))
	}
}

func TestValidateChecksTheShoutrrrAddresses(t *testing.T) {
	cases := map[string]struct {
		channel Channel
		field   string
		code    string
	}{
		"no settings":     {Channel{Channel: kit.Channel{ID: "a", Kind: KindShoutrrr, Enabled: true}}, "shoutrrr", kit.ProblemMissingSettings},
		"no address":      {shoutrrr("a", kit.OnFailure), "shoutrrr.urls", kit.ProblemMissingField},
		"blank address":   {shoutrrr("a", kit.OnFailure, "ntfy://ntfy.sh/topic", " "), "shoutrrr.urls.1", kit.ProblemMissingField},
		"unknown service": {shoutrrr("a", kit.OnFailure, "nosuch://SECRET@host"), "shoutrrr.urls.0", kit.ProblemBadURL},
		"bad when":        {shoutrrr("a", "sometimes", "ntfy://ntfy.sh/topic"), "on", kit.ProblemBadOn},
	}
	for what, tc := range cases {
		err := Validate([]Channel{tc.channel})
		var ps kit.Problems
		if !errors.As(err, &ps) || len(ps) != 1 || ps[0].Field != tc.field || ps[0].Code != tc.code {
			t.Errorf("%s: got %v", what, err)
			continue
		}
		if strings.Contains(err.Error(), "SECRET") {
			t.Errorf("%s: the problem quotes the address: %v", what, err)
		}
	}
}

func TestValidateLetsAShoutrrrChannelBeIncompleteWhileItIsOff(t *testing.T) {
	off := Channel{Channel: kit.Channel{ID: "a", Kind: KindShoutrrr}}
	if err := Validate([]Channel{off}); err != nil {
		t.Errorf("a channel being filled in was refused: %v", err)
	}
}

func TestValidateFindsTwoChannelsUnderOneIdAcrossKinds(t *testing.T) {
	ntfy := Channel{Channel: kit.Channel{ID: "a", Kind: kit.KindNtfy, Enabled: true, Ntfy: &kit.Ntfy{URL: "https://ntfy.sh/t"}}}
	err := Validate([]Channel{ntfy, shoutrrr("a", kit.OnFailure, "ntfy://ntfy.sh/topic")})
	var ps kit.Problems
	if !errors.As(err, &ps) || len(ps) != 1 || ps[0].Index != 1 || ps[0].Code != kit.ProblemDuplicateID {
		t.Errorf("got %v", err)
	}
}

func TestAShoutrrrChannelReadsAndWritesTheKitsShape(t *testing.T) {
	raw := `{"id":"shout","kind":"shoutrrr","enabled":true,"on":"always","shoutrrr":{"urls":["ntfy://ntfy.sh/topic"]}}`
	var c Channel
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		t.Fatal(err)
	}
	if c.ID != "shout" || c.On != kit.OnAlways || c.Shoutrrr == nil || c.Shoutrrr.URLs[0] != "ntfy://ntfy.sh/topic" {
		t.Fatalf("read as %+v", c)
	}
	back, _ := json.Marshal(c)
	if string(back) != raw {
		t.Errorf("written as %s", back)
	}
}
