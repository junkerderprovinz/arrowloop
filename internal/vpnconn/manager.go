// Package vpnconn brings the built-in VPN up for the runs of the jobs that go
// through it, and takes it down once the last of them has finished: the
// providers of the VPN settings, their sealed logins, the one tunnel those
// runs share and the loopback proxy their connections reach it by. Nothing
// else of ArrowLoop goes through the tunnel.
package vpnconn

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/vpn"
)

// Options configure a Manager.
type Options struct {
	// Dir is the configuration's folder, where FileName lives.
	Dir string
	// Key is the install's key, which seals the logins.
	Key  []byte
	Logf func(format string, args ...any)
	// ConnectTimeout bounds opening a provider's session and the first
	// handshake. A run waits that long before it fails.
	ConnectTimeout time.Duration
	// HoldFor is how long a connection waits for a tunnel that dropped in the
	// middle of a run before it fails.
	HoldFor time.Duration
	// ExitIPURL answers with the address a request through the tunnel comes
	// from, for the connection test.
	ExitIPURL string
	// Tunnel tunes the tunnel, for tests.
	Tunnel vpn.Options
}

// ErrNotSetUp is a run of a job that goes through the VPN while no provider is
// set up for it.
var ErrNotSetUp = errors.New("no VPN is set up in the settings")

// Refusal is a call the routes answer with an error status, a code the page
// words and, for a field, the field.
type Refusal struct {
	Status int
	Code   string
	Field  string
	Text   string
}

func (r *Refusal) Error() string { return r.Text }

// ProviderState is one tile as the settings show it. A login never comes back,
// only whether one is stored.
type ProviderState struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Fields     []string `json:"fields"`
	Configured bool     `json:"configured"`
	// Location is the stored location, which is no secret, so the form can
	// show it.
	Location string `json:"location,omitempty"`
}

// Status is where the VPN stands as the settings word it.
type Status string

const (
	// Down means no run needs the tunnel, so there is none.
	Down       Status = "down"
	Connecting Status = "connecting"
	Connected  Status = "connected"
	// Reconnecting means the tunnel dropped under a run and is coming back;
	// the run's connections wait for it.
	Reconnecting Status = "reconnecting"
	// Failed means the last attempt did not come up. The runs that wanted it
	// failed with the reason.
	Failed Status = "failed"
)

// State is the VPN settings' whole state.
type State struct {
	// Provider is the one runs go through, "" for none.
	Provider string `json:"provider"`
	Status   Status `json:"status"`
	// Jobs are the runs that hold the tunnel up.
	Jobs      []string        `json:"jobs"`
	Endpoint  string          `json:"endpoint,omitempty"`
	ExitIP    string          `json:"exitIp,omitempty"`
	Error     string          `json:"error,omitempty"`
	ErrorCode string          `json:"errorCode,omitempty"`
	Providers []ProviderState `json:"providers"`
}

// Manager owns the tunnel. Runs ask for it with Acquire.
type Manager struct {
	opts      Options
	store     *store
	providers []Provider
	tun       *vpn.Tunnel

	// op keeps to one bring-up or take-down of the tunnel at a time, so taking
	// down the tunnel of runs that ended never takes down the next one.
	op      sync.Mutex
	current *bringUp

	mu     sync.Mutex
	up     *bringUp
	fail   *failure
	exitIP string
}

// bringUp is one stretch of the tunnel being up, from the first run that
// needs it to the last that lets it go.
type bringUp struct {
	provider string
	done     chan struct{}
	cancel   context.CancelFunc
	// holders count the runs holding it by job name; guarded by Manager.mu.
	holders map[string]int

	// Set by bring before done closes, read only after.
	err      error
	px       *proxy
	sess     *session
	stopKeep context.CancelFunc

	// down keeps a run that lets go after Close from taking it down twice.
	down sync.Once
}

func (b *bringUp) held() bool {
	for _, n := range b.holders {
		if n > 0 {
			return true
		}
	}
	return false
}

// New opens the logins beside the configuration. Nothing connects until a run
// asks.
func New(opts Options) (*Manager, error) {
	if opts.Logf == nil {
		opts.Logf = func(string, ...any) {}
	}
	if opts.ConnectTimeout <= 0 {
		opts.ConnectTimeout = 45 * time.Second
	}
	if opts.HoldFor <= 0 {
		opts.HoldFor = 30 * time.Second
	}
	if opts.ExitIPURL == "" {
		opts.ExitIPURL = "https://api.ipify.org"
	}
	if opts.Tunnel.Logf == nil {
		opts.Tunnel.Logf = opts.Logf
	}
	st, err := openStore(opts.Dir, opts.Key)
	if err != nil {
		return nil, err
	}
	return &Manager{opts: opts, store: st, providers: catalogue(), tun: vpn.New(opts.Tunnel)}, nil
}

func (m *Manager) provider(id string) *Provider {
	i := slices.IndexFunc(m.providers, func(p Provider) bool { return p.ID == id })
	if i < 0 {
		return nil
	}
	return &m.providers[i]
}

// Lease is one run's hold on the tunnel.
type Lease struct {
	m      *Manager
	b      *bringUp
	holder string
	once   sync.Once
}

// Acquire brings the tunnel up for holder's run, or joins the runs it is up
// for already, and returns once it carries traffic. A tunnel that does not
// come up is an error and holds nothing, so the run fails rather than going
// out over the machine's own network.
func (m *Manager) Acquire(ctx context.Context, holder string) (*Lease, error) {
	id := m.store.provider()
	if id == "" || m.provider(id) == nil {
		return nil, ErrNotSetUp
	}
	m.mu.Lock()
	b := m.up
	if b == nil || failedBringUp(b) {
		bctx, cancel := context.WithCancel(context.Background())
		b = &bringUp{provider: id, done: make(chan struct{}), cancel: cancel, holders: map[string]int{}}
		m.up, m.fail, m.exitIP = b, nil, ""
		go m.bring(bctx, b)
	}
	b.holders[holder]++
	m.mu.Unlock()

	select {
	case <-b.done:
	case <-ctx.Done():
		m.release(holder, b)
		return nil, ctx.Err()
	}
	if b.err != nil {
		m.release(holder, b)
		return nil, b.err
	}
	return &Lease{m: m, b: b, holder: holder}, nil
}

func failedBringUp(b *bringUp) bool {
	select {
	case <-b.done:
		return b.err != nil
	default:
		return false
	}
}

// Release lets go of the tunnel. The last run to let go takes it down.
func (l *Lease) Release() {
	l.once.Do(func() { l.m.release(l.holder, l.b) })
}

// Proxy is the address the run's connections go through.
func (l *Lease) Proxy() string { return l.b.px.URL() }

func (m *Manager) release(holder string, b *bringUp) {
	m.mu.Lock()
	b.holders[holder]--
	if b.holders[holder] <= 0 {
		delete(b.holders, holder)
	}
	last := !b.held()
	if last && m.up == b {
		m.up = nil
	}
	m.mu.Unlock()
	if last {
		m.takeDown(b)
	}
}

// bring opens a session with the provider in use, sets the tunnel up on it and
// waits for the handshake.
func (m *Manager) bring(ctx context.Context, b *bringUp) {
	defer close(b.done)
	m.op.Lock()
	defer m.op.Unlock()
	if b.err = m.connect(ctx, b); b.err != nil {
		f := classify(b.err)
		m.mu.Lock()
		m.fail = f
		m.mu.Unlock()
		m.opts.Logf("vpn: %v", b.err)
	}
}

func (m *Manager) connect(ctx context.Context, b *bringUp) error {
	p := m.provider(b.provider)
	login, err := m.store.login(p.ID)
	if err != nil {
		return err
	}
	octx, cancel := context.WithTimeout(ctx, m.opts.ConnectTimeout)
	defer cancel()
	sess, err := p.open(octx, login)
	if sess != nil && sess.login != nil {
		// A key the provider registered is kept even when a later step fails,
		// so the account does not fill up with new ones.
		if kerr := m.store.keep(p.ID, sess.login); kerr != nil {
			m.opts.Logf("vpn: keep the login of %s: %v", p.Name, kerr)
		}
	}
	if err != nil {
		return fmt.Errorf("%s: %w", p.Name, err)
	}
	if err := m.tun.Connect(octx, sess.cfg); err != nil {
		endSoon(sess)
		if errors.Is(err, vpn.ErrResolve) {
			return &failure{CodeTimeout, fmt.Errorf("%s: %w", p.Name, err)}
		}
		return &failure{CodeConfigInvalid, fmt.Errorf("%s: %w", p.Name, err)}
	}
	m.current = b
	if err := m.tun.WaitConnected(octx); err != nil {
		m.tun.Disconnect()
		m.current = nil
		endSoon(sess)
		return &failure{CodeTimeout, fmt.Errorf("%s: no handshake with %s within %s", p.Name, sess.cfg.Peer.Endpoint, m.opts.ConnectTimeout)}
	}
	px, err := startProxy(m.dial)
	if err != nil {
		m.tun.Disconnect()
		m.current = nil
		endSoon(sess)
		return err
	}
	b.px, b.sess = px, sess
	if sess.keep != nil {
		kctx, stop := context.WithCancel(context.Background())
		b.stopKeep = stop
		go sess.keep(kctx, m.opts.Logf)
	}
	m.opts.Logf("vpn: %s connected through %s", p.Name, sess.cfg.Peer.Endpoint)
	return nil
}

// takeDown ends a bring-up nobody holds any more: its proxy, which ends every
// connection that came through it, its tunnel and its session.
func (m *Manager) takeDown(b *bringUp) {
	b.down.Do(func() { m.takeDownOnce(b) })
}

func (m *Manager) takeDownOnce(b *bringUp) {
	b.cancel()
	<-b.done
	m.op.Lock()
	defer m.op.Unlock()
	if b.stopKeep != nil {
		b.stopKeep()
	}
	if b.px != nil {
		b.px.close()
	}
	if m.current == b {
		m.tun.Disconnect()
		m.current = nil
		m.opts.Logf("vpn: down, no run needs it")
	}
	endSoon(b.sess)
}

// dial reaches address through the tunnel. A tunnel that dropped in the
// middle of a run is waited for, the way a kill switch holds traffic back,
// and never gone around.
func (m *Manager) dial(ctx context.Context, network, address string) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, m.opts.HoldFor)
	defer cancel()
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for {
		c, err := m.tun.DialContext(ctx, network, address)
		if !errors.Is(err, vpn.ErrDown) {
			return c, err
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("the VPN tunnel is down: %w", ctx.Err())
		case <-tick.C:
		}
	}
}

// State is the VPN settings' state.
func (m *Manager) State() State {
	configured := m.store.configured()
	out := State{Provider: m.store.provider(), Jobs: []string{}, Providers: make([]ProviderState, 0, len(m.providers))}
	for _, p := range m.providers {
		ps := ProviderState{ID: p.ID, Name: p.Name, Fields: slices.Clone(p.Fields), Configured: configured[p.ID]}
		if ps.Configured && slices.Contains(p.Fields, "location") {
			if login, err := m.store.login(p.ID); err == nil {
				ps.Location = login["location"]
			}
		}
		out.Providers = append(out.Providers, ps)
	}
	ts := m.tun.State()
	m.mu.Lock()
	defer m.mu.Unlock()
	out.ExitIP = m.exitIP
	switch b := m.up; {
	case b != nil && !failedBringUp(b):
		for job := range b.holders {
			if job != "" {
				out.Jobs = append(out.Jobs, job)
			}
		}
		slices.Sort(out.Jobs)
		out.Status = Connecting
		select {
		case <-b.done:
			out.Status = Connected
			if ts.Status == vpn.Reconnecting || ts.Status == vpn.Connecting {
				out.Status = Reconnecting
			}
			if ts.Endpoint.IsValid() {
				out.Endpoint = ts.Endpoint.String()
			}
		default:
		}
	case m.fail != nil:
		out.Status, out.Error, out.ErrorCode = Failed, m.fail.Error(), m.fail.code
	default:
		out.Status = Down
	}
	return out
}

// Save stores a provider's login and makes it the one runs go through. Fields
// left empty keep what is stored. A run already going keeps the tunnel it has;
// the next one takes the new login.
func (m *Manager) Save(id string, fields map[string]string) (State, error) {
	p := m.provider(id)
	if p == nil {
		return State{}, &Refusal{Status: http.StatusNotFound, Code: "vpn-unknown", Text: fmt.Sprintf("no VPN provider %q", id)}
	}
	login, err := m.store.login(id)
	if err != nil {
		return State{}, err
	}
	changed := false
	for k, v := range fields {
		if !slices.Contains(p.Fields, k) {
			return State{}, &Refusal{Status: http.StatusBadRequest, Code: "vpn-field-unknown", Field: k, Text: fmt.Sprintf("%s asks for no %s", p.Name, k)}
		}
		blank := strings.TrimSpace(v) == ""
		switch {
		case blank && k == "location" && login[k] != "":
			// The page sends the location only once it was edited, so an
			// emptied one goes back to any server.
			delete(login, k)
		case blank || login[k] == v:
			continue
		default:
			login[k] = v
		}
		// What a provider kept beside the login belongs to the login it came
		// with.
		for _, kept := range []string{accessTokenField, tokenField} {
			delete(login, kept)
		}
		changed = true
	}
	for _, f := range p.Fields {
		if f != "location" && strings.TrimSpace(login[f]) == "" {
			return State{}, &Refusal{Status: http.StatusBadRequest, Code: "vpn-field-missing", Field: f, Text: f + " is missing"}
		}
	}
	if slices.Contains(p.Fields, "config") {
		if _, err := vpn.ParseConfig(login["config"]); err != nil {
			return State{}, &Refusal{Status: http.StatusBadRequest, Code: CodeConfigInvalid, Field: "config", Text: err.Error()}
		}
	}
	if changed {
		err = m.store.save(id, login)
	} else {
		err = m.store.use(id)
	}
	if err != nil {
		return State{}, err
	}
	m.mu.Lock()
	m.fail = nil
	m.mu.Unlock()
	return m.State(), nil
}

// Forget deletes a provider's login. When it was the one in use, runs that go
// through the VPN fail until another is set up.
func (m *Manager) Forget(id string) (State, error) {
	p := m.provider(id)
	if p == nil {
		return State{}, &Refusal{Status: http.StatusNotFound, Code: "vpn-unknown", Text: fmt.Sprintf("no VPN provider %q", id)}
	}
	login, _ := m.store.login(id)
	if err := m.store.forget(id); err != nil {
		return State{}, err
	}
	if p.forget != nil && len(login) > 0 {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			p.forget(ctx, login)
		}()
	}
	return m.State(), nil
}

// Test brings the tunnel up the way a run would, asks through it which
// address the traffic leaves by, and lets it go again.
func (m *Manager) Test(ctx context.Context) (State, error) {
	lease, err := m.Acquire(ctx, "")
	if err != nil {
		return m.State(), err
	}
	ip, err := m.lookUpExitIP(ctx, lease.Proxy())
	lease.Release()
	if err != nil {
		m.opts.Logf("vpn: exit address: %v", err)
	}
	m.mu.Lock()
	m.exitIP = ip
	m.mu.Unlock()
	return m.State(), nil
}

func (m *Manager) lookUpExitIP(ctx context.Context, proxyURL string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	via, err := url.Parse(proxyURL)
	if err != nil {
		return "", err
	}
	tr := &http.Transport{Proxy: http.ProxyURL(via)}
	defer tr.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.opts.ExitIPURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := (&http.Client{Transport: tr}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 64))
	return strings.TrimSpace(string(b)), err
}

// Close takes the tunnel down, whoever still holds it, as the program ends.
func (m *Manager) Close() {
	m.mu.Lock()
	b := m.up
	m.up = nil
	m.mu.Unlock()
	if b != nil {
		m.takeDown(b)
	}
}
