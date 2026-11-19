package notify

import (
	"cmp"
	"context"
	"crypto/x509"
	"errors"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"

	kit "github.com/junkerderprovinz/parleyport/kit/notify"
	"github.com/nicholas-fedor/shoutrrr/pkg/router"
	"github.com/nicholas-fedor/shoutrrr/pkg/types"
)

// Dispatcher sends events to a fixed set of channels: the kit's kinds through
// the kit, the Shoutrrr channels through Shoutrrr, with the same "when",
// attempts and time limits.
type Dispatcher struct {
	kit      *kit.Dispatcher
	shoutrrr []Channel
	client   *http.Client
	sleep    func(context.Context, time.Duration) bool
}

// NewDispatcher checks channels with Validate and returns a Dispatcher for
// them.
func NewDispatcher(channels []Channel, opt kit.Options) (*Dispatcher, error) {
	if err := Validate(channels); err != nil {
		return nil, err
	}
	d := &Dispatcher{client: opt.HTTP, sleep: sleep}
	var theirs []kit.Channel
	for _, c := range channels {
		if c.Kind == KindShoutrrr {
			d.shoutrrr = append(d.shoutrrr, c)
		} else {
			theirs = append(theirs, c.Channel)
		}
	}
	var err error
	d.kit, err = kit.NewDispatcher(theirs, opt)
	if err != nil {
		return nil, err
	}
	return d, nil
}

// Send is the kit's Send, with the results of the Shoutrrr channels after the
// kit's.
func (d *Dispatcher) Send(ctx context.Context, e kit.Event) []kit.Result {
	var chosen []Channel
	for _, c := range d.shoutrrr {
		if takes(c, e) {
			chosen = append(chosen, c)
		}
	}
	ours := make([]kit.Result, len(chosen))
	var wg sync.WaitGroup
	for i, c := range chosen {
		wg.Go(func() { ours[i] = d.shout(ctx, c, attempts(c), e) })
	}
	theirs := d.kit.Send(ctx, e)
	wg.Wait()
	return append(theirs, ours...)
}

// Ping is the kit's Ping. Only a Healthchecks channel takes a ping.
func (d *Dispatcher) Ping(ctx context.Context, e kit.Event) []kit.Result {
	return d.kit.Ping(ctx, e)
}

// Test sends e to ch once, as the kit's Test does, whether or not ch is
// enabled and whatever its On and Events say.
func (d *Dispatcher) Test(ctx context.Context, ch Channel, e kit.Event) kit.Result {
	if ch.Kind != KindShoutrrr {
		return d.kit.Test(ctx, ch.Channel, e)
	}
	ch.Enabled = true
	if err := Validate([]Channel{ch}); err != nil {
		return kit.Result{Channel: ch.ID, Kind: ch.Kind, Code: kit.CodeInvalid, Err: err}
	}
	return d.shout(ctx, ch, 1, e)
}

func takes(c Channel, e kit.Event) bool {
	if !c.Enabled || (len(c.Events) > 0 && !slices.Contains(c.Events, e.Kind)) {
		return false
	}
	switch c.On {
	case kit.OnAlways:
		return true
	case kit.OnNever:
		return false
	}
	return e.Severity == kit.SeverityWarning || e.Severity == kit.SeverityFailure || e.Severity == kit.SeverityCritical
}

func attempts(c Channel) int {
	if c.Attempts <= 0 {
		return kit.DefaultAttempts
	}
	return min(c.Attempts, kit.MaxAttempts)
}

func timeout(c Channel) time.Duration {
	secs := c.TimeoutSeconds
	if secs <= 0 {
		secs = kit.DefaultTimeoutSeconds
	}
	return time.Duration(min(secs, kit.MaxTimeoutSeconds)) * time.Second
}

// backoff is the pause after each failed attempt, the kit's.
var backoff = []time.Duration{2 * time.Second, 8 * time.Second, 30 * time.Second}

// shout sends e to every address of c. Shoutrrr's errors do not say whether
// another try could help, so each failure is tried again, and only at the
// addresses that failed, or a service that took the message would get it
// twice.
func (d *Dispatcher) shout(ctx context.Context, c Channel, attempts int, e kit.Event) kit.Result {
	r := kit.Result{Channel: c.ID, Kind: c.Kind}
	message := strings.Join(slices.DeleteFunc([]string{e.Body, e.Link}, func(s string) bool { return s == "" }), "\n")
	if message == "" {
		message = e.Title
	}
	pending := c.Shoutrrr.URLs
	for {
		r.Attempts++
		failed, err := d.once(ctx, pending, timeout(c), message, e.Title)
		if err == nil {
			r.Code, r.Err = "", nil
			return r
		}
		r.Code, r.Err = code(err), redact(c, err)
		if r.Attempts >= attempts || ctx.Err() != nil {
			return r
		}
		if !d.sleep(ctx, backoff[min(r.Attempts, len(backoff))-1]) {
			return r
		}
		pending = failed
	}
}

// once sends to urls and returns the ones that failed. A nil logger keeps
// Shoutrrr from writing anything, addresses included.
func (d *Dispatcher) once(ctx context.Context, urls []string, limit time.Duration, message, title string) ([]string, error) {
	opts := types.SenderOptions{Timeout: limit}
	if d.client != nil {
		opts.HTTPClient = d.client
	}
	sender, err := router.NewWithOptions(nil, opts, urls...)
	if err != nil {
		return urls, err
	}
	defer func() { _ = sender.Close() }()
	params := types.Params{}
	if title != "" {
		params[types.TitleKey] = title
	}
	var failed []string
	var errs []error
	for i, err := range sender.SendContext(ctx, message, &params) {
		if err != nil {
			failed = append(failed, urls[i])
			errs = append(errs, err)
		}
	}
	return failed, errors.Join(errs...)
}

// code is the kit's Code for what err says went wrong. Shoutrrr reports a
// service's refusal in words of its own, so whatever is not the network is
// taken as one.
func code(err error) string {
	var dns *net.DNSError
	var unknown x509.UnknownAuthorityError
	var invalid x509.CertificateInvalidError
	var hostname x509.HostnameError
	var network net.Error
	switch {
	case errors.Is(err, context.Canceled):
		return kit.CodeCanceled
	case errors.Is(err, router.ErrServiceTimeout), errors.Is(err, context.DeadlineExceeded):
		return kit.CodeTimeout
	case errors.As(err, &dns):
		return kit.CodeDNS
	case errors.Is(err, syscall.ECONNREFUSED), errors.Is(err, wsaeconnrefused):
		return kit.CodeRefused
	case errors.As(err, &unknown), errors.As(err, &invalid), errors.As(err, &hostname):
		return kit.CodeTLS
	case errors.As(err, &network):
		return kit.CodeNetwork
	}
	return kit.CodeRejected
}

// wsaeconnrefused is Winsock's "connection refused", which Go does not map to
// syscall.ECONNREFUSED on Windows.
const wsaeconnrefused = syscall.Errno(10061)

// minSecret is the shortest part of an address taken for a key, the kit's,
// so that a status code in the message stays readable.
const minSecret = 4

// redact takes every part of c's addresses that may be a key out of err, then
// cuts every address left in it down to its scheme and host, as the kit does
// for its own kinds.
func redact(c Channel, err error) error {
	var secrets []string
	for _, raw := range c.Shoutrrr.URLs {
		secrets = append(secrets, addressSecrets(raw)...)
	}
	slices.SortFunc(secrets, func(a, b string) int { return cmp.Compare(len(b), len(a)) })
	s := err.Error()
	for _, secret := range secrets {
		for _, form := range []string{secret, url.QueryEscape(secret), url.PathEscape(secret)} {
			s = strings.ReplaceAll(s, form, Placeholder)
		}
	}
	return kit.Redact(errors.New(s))
}

// addressSecrets are the parts of a Shoutrrr address that may be a key, by
// the kit's rules for its own addresses: the login, the query values and long
// path segments. Unless the address names a web server, as generic+https://
// does, its host can be a key too, as a Pushover user key is, except where it
// only repeats the service's name, as in telegram://token@telegram.
func addressSecrets(raw string) []string {
	raw = strings.TrimSpace(raw)
	out := []string{raw}
	u, err := url.Parse(raw)
	if err != nil {
		return out
	}
	service, web, _ := strings.Cut(u.Scheme, "+")
	if u.User != nil {
		pass, _ := u.User.Password()
		out = append(out, u.User.String(), u.User.Username(), pass)
	}
	if web != "http" && web != "https" && !strings.EqualFold(u.Hostname(), service) {
		out = append(out, u.Hostname())
	}
	for _, seg := range strings.Split(u.Path, "/") {
		if len(seg) >= 12 {
			out = append(out, seg)
		}
	}
	for _, vs := range u.Query() {
		out = append(out, vs...)
	}
	out = append(out, u.Fragment)
	return slices.DeleteFunc(out, func(s string) bool { return len(s) < minSecret })
}

func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
