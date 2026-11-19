// Package vpnconn brings the built-in VPN's tunnels up for the runs of the
// jobs that go through them, and takes each down once the last of its runs
// has finished: the providers of the VPN settings, the tunnels set up with
// them and their sealed logins, and the loopback proxy a run's connections
// reach its tunnel by. Nothing else of ArrowLoop goes through a tunnel, and a
// run only ever goes through its own job's.
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
	// Tunnel tunes the tunnels, for tests.
	Tunnel vpn.Options
}

// ErrNotUp is a Join on a tunnel that no run holds up.
var ErrNotUp = errors.New("the VPN is off until a run of its job needs it")

// ErrNotSetUp is a run of a job whose tunnel is not set up in the settings.
var ErrNotSetUp = errors.New("the VPN this job goes through is not set up in the settings")

// Refusal is a call the routes answer with an error status, a code the page
// words and, for a field, the field. A configuration that does not read names
// the line and its text, which the page words too.
type Refusal struct {
	Status   int
	Code     string
	Field    string
	Line     int
	LineText string
	Text     string
}

func (r *Refusal) Error() string { return r.Text }

// ProviderState is one tile of the settings' picker.
type ProviderState struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Fields []string `json:"fields"`
}

// Status is where a tunnel stands as the settings word it.
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

// TunnelState is one tunnel as the settings list it. Its login never comes
// back, only where it leads.
type TunnelState struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	// Place is the location the login names or the host of its endpoint.
	Place  string `json:"place,omitempty"`
	Status Status `json:"status"`
	// Jobs are the runs that hold the tunnel up.
	Jobs      []string `json:"jobs"`
	Endpoint  string   `json:"endpoint,omitempty"`
	ExitIP    string   `json:"exitIp,omitempty"`
	Error     string   `json:"error,omitempty"`
	ErrorCode string   `json:"errorCode,omitempty"`
}

// State is the VPN settings' whole state.
type State struct {
	Tunnels   []TunnelState   `json:"tunnels"`
	Providers []ProviderState `json:"providers"`
}

// Manager owns the tunnels. Runs ask for one with Acquire.
type Manager struct {
	opts      Options
	store     *store
	providers []Provider

	mu    sync.Mutex
	wires map[string]*wire
}

// wire is one tunnel's WireGuard connection and where it stands.
type wire struct {
	tun *vpn.Tunnel

	// op keeps to one bring-up or take-down of the tunnel at a time, so taking
	// down the tunnel of runs that ended never takes down the next one.
	op      sync.Mutex
	current *bringUp

	// Guarded by Manager.mu.
	up     *bringUp
	fail   *failure
	exitIP string
}

// bringUp is one stretch of a tunnel being up, from the first run that needs
// it to the last that lets it go.
type bringUp struct {
	tunnel string
	w      *wire
	done   chan struct{}
	cancel context.CancelFunc
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

// New opens the tunnels beside the configuration. Nothing connects until a
// run asks.
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
	st, err := openStore(opts.Dir, opts.Key, placeOf)
	if err != nil {
		return nil, err
	}
	return &Manager{opts: opts, store: st, providers: catalogue(), wires: map[string]*wire{}}, nil
}

func (m *Manager) provider(id string) *Provider {
	i := slices.IndexFunc(m.providers, func(p Provider) bool { return p.ID == id })
	if i < 0 {
		return nil
	}
	return &m.providers[i]
}

// wire is tunnel id's connection, made the first time it is asked for.
func (m *Manager) wire(id string) *wire {
	m.mu.Lock()
	defer m.mu.Unlock()
	w := m.wires[id]
	if w == nil {
		w = &wire{tun: vpn.New(m.opts.Tunnel)}
		m.wires[id] = w
	}
	return w
}

// placeOf names where a login leads: the location it names, or the host of
// its configuration's endpoint.
func placeOf(login Login) string {
	if loc := strings.TrimSpace(login["location"]); loc != "" {
		return loc
	}
	cfg, err := vpn.ParseConfig(login["config"])
	if err != nil {
		return ""
	}
	host, _, err := net.SplitHostPort(cfg.Peer.Endpoint)
	if err != nil {
		return ""
	}
	return host
}

// Former is the tunnel a job goes through whose file says only that it goes
// through the VPN, as one written when there could be only one; "" when that
// tunnel is gone or there was none.
func (m *Manager) Former() string { return m.store.former() }

// Lease is one run's hold on its tunnel.
type Lease struct {
	m      *Manager
	b      *bringUp
	holder string
	once   sync.Once
}

// Acquire brings tunnel up for holder's run, or joins the runs it is up for
// already, and returns once it carries traffic. A tunnel that does not come
// up is an error and holds nothing, so the run fails rather than going out
// over the machine's own network.
func (m *Manager) Acquire(ctx context.Context, tunnel, holder string) (*Lease, error) {
	t, ok := m.store.tunnel(tunnel)
	if !ok || m.provider(t.Provider) == nil {
		return nil, ErrNotSetUp
	}
	w := m.wire(tunnel)
	m.mu.Lock()
	b := w.up
	if b == nil || failedBringUp(b) {
		bctx, cancel := context.WithCancel(context.Background())
		b = &bringUp{tunnel: tunnel, w: w, done: make(chan struct{}), cancel: cancel, holders: map[string]int{}}
		w.up, w.fail, w.exitIP = b, nil, ""
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

// Join holds tunnel for holder only when a run holds it up already, and
// otherwise fails with ErrNotUp without logging in at the provider.
func (m *Manager) Join(tunnel, holder string) (*Lease, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	w := m.wires[tunnel]
	if w == nil || w.up == nil {
		return nil, ErrNotUp
	}
	b := w.up
	select {
	case <-b.done:
		if b.err != nil {
			return nil, ErrNotUp
		}
	default:
		return nil, ErrNotUp
	}
	b.holders[holder]++
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
	if last && b.w.up == b {
		b.w.up = nil
	}
	m.mu.Unlock()
	if last {
		m.takeDown(b)
	}
}

// bring opens a session with the tunnel's provider, sets the tunnel up on it
// and waits for the handshake.
func (m *Manager) bring(ctx context.Context, b *bringUp) {
	defer close(b.done)
	b.w.op.Lock()
	defer b.w.op.Unlock()
	if b.err = m.connect(ctx, b); b.err != nil {
		f := classify(b.err)
		m.mu.Lock()
		b.w.fail = f
		m.mu.Unlock()
		m.opts.Logf("vpn: %v", b.err)
	}
}

func (m *Manager) connect(ctx context.Context, b *bringUp) error {
	t, ok := m.store.tunnel(b.tunnel)
	if !ok {
		return ErrNotSetUp
	}
	p := m.provider(t.Provider)
	login, err := m.store.login(b.tunnel)
	if err != nil {
		return err
	}
	octx, cancel := context.WithTimeout(ctx, m.opts.ConnectTimeout)
	defer cancel()
	sess, err := p.open(octx, login)
	if sess != nil && sess.login != nil {
		// A key the provider registered is kept even when a later step fails,
		// so the account does not fill up with new ones.
		if kerr := m.store.keep(b.tunnel, sess.login); kerr != nil {
			m.opts.Logf("vpn: keep the login of %s: %v", p.Name, kerr)
		}
	}
	if err != nil {
		return fmt.Errorf("%s: %w", p.Name, err)
	}
	w := b.w
	if err := w.tun.Connect(octx, sess.cfg); err != nil {
		endSoon(sess)
		if errors.Is(err, vpn.ErrResolve) {
			return &failure{CodeNameUnresolved, fmt.Errorf("%s: %w", p.Name, err)}
		}
		return &failure{CodeConfigInvalid, fmt.Errorf("%s: %w", p.Name, err)}
	}
	w.current = b
	if err := w.tun.WaitConnected(octx); err != nil {
		w.tun.Disconnect()
		w.current = nil
		endSoon(sess)
		return &failure{CodeTimeout, fmt.Errorf("%s: no handshake with %s within %s", p.Name, sess.cfg.Peer.Endpoint, m.opts.ConnectTimeout)}
	}
	px, err := startProxy(func(ctx context.Context, network, address string) (net.Conn, error) {
		return m.dial(ctx, w, network, address)
	})
	if err != nil {
		w.tun.Disconnect()
		w.current = nil
		endSoon(sess)
		return err
	}
	b.px, b.sess = px, sess
	if sess.keep != nil {
		kctx, stop := context.WithCancel(context.Background())
		b.stopKeep = stop
		go sess.keep(kctx, m.opts.Logf)
	}
	m.opts.Logf("vpn: %s (%s) connected through %s", p.Name, b.tunnel, sess.cfg.Peer.Endpoint)
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
	w := b.w
	w.op.Lock()
	defer w.op.Unlock()
	if b.stopKeep != nil {
		b.stopKeep()
	}
	if b.px != nil {
		b.px.close()
	}
	if w.current == b {
		w.tun.Disconnect()
		w.current = nil
		m.opts.Logf("vpn: %s down, no run needs it", b.tunnel)
	}
	endSoon(b.sess)
}

// dial reaches address through w's tunnel. A tunnel that dropped in the
// middle of a run is waited for, the way a kill switch holds traffic back,
// and never gone around.
func (m *Manager) dial(ctx context.Context, w *wire, network, address string) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, m.opts.HoldFor)
	defer cancel()
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for {
		c, err := w.tun.DialContext(ctx, network, address)
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
	out := State{Tunnels: []TunnelState{}, Providers: make([]ProviderState, 0, len(m.providers))}
	for _, p := range m.providers {
		out.Providers = append(out.Providers, ProviderState{ID: p.ID, Name: p.Name, Fields: slices.Clone(p.Fields)})
	}
	for _, t := range m.store.tunnels() {
		out.Tunnels = append(out.Tunnels, m.tunnelState(t))
	}
	return out
}

func (m *Manager) tunnelState(t keptTunnel) TunnelState {
	out := TunnelState{ID: t.ID, Provider: t.Provider, Place: t.Place, Status: Down, Jobs: []string{}}
	m.mu.Lock()
	w := m.wires[t.ID]
	m.mu.Unlock()
	if w == nil {
		return out
	}
	ts := w.tun.State()
	m.mu.Lock()
	defer m.mu.Unlock()
	out.ExitIP = w.exitIP
	switch b := w.up; {
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
	case w.fail != nil:
		out.Status, out.Error, out.ErrorCode = Failed, w.fail.Error(), w.fail.code
	}
	return out
}

func unknownProvider(id string) error {
	return &Refusal{Status: http.StatusNotFound, Code: "vpn-unknown", Text: fmt.Sprintf("no VPN provider %q", id)}
}

// fill writes fields into login, refusing what p's form does not ask for and
// a login that is still missing something. Fields left empty keep what login
// has. It reports whether anything changed.
func fill(p *Provider, login Login, fields map[string]string) (bool, error) {
	changed := false
	for k, v := range fields {
		if !slices.Contains(p.Fields, k) {
			return false, &Refusal{Status: http.StatusBadRequest, Code: "vpn-field-unknown", Field: k, Text: fmt.Sprintf("%s asks for no %s", p.Name, k)}
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
			return false, &Refusal{Status: http.StatusBadRequest, Code: "vpn-field-missing", Field: f, Text: f + " is missing"}
		}
	}
	if slices.Contains(p.Fields, "config") {
		if _, err := vpn.ParseConfig(login["config"]); err != nil {
			ref := &Refusal{Status: http.StatusBadRequest, Code: CodeConfigInvalid, Field: "config", Text: err.Error()}
			var le *vpn.LineError
			if errors.As(err, &le) {
				ref.Line, ref.LineText = le.Line, le.Text
			}
			return false, ref
		}
	}
	return changed, nil
}

// Add sets up a new tunnel with provider and returns its id. A provider may
// have several, such as two servers of one's own or two locations.
func (m *Manager) Add(provider string, fields map[string]string) (string, State, error) {
	p := m.provider(provider)
	if p == nil {
		return "", State{}, unknownProvider(provider)
	}
	login := Login{}
	if _, err := fill(p, login, fields); err != nil {
		return "", State{}, err
	}
	id, err := m.store.add(provider, placeOf(login), login)
	if err != nil {
		return "", State{}, err
	}
	return id, m.State(), nil
}

// Save changes the login of tunnel id. Fields left empty keep what is stored.
// A run already going keeps the tunnel it has; the next one takes the new
// login.
func (m *Manager) Save(id string, fields map[string]string) (State, error) {
	t, ok := m.store.tunnel(id)
	if !ok {
		return State{}, &Refusal{Status: http.StatusNotFound, Code: "vpn-unknown", Text: fmt.Sprintf("no VPN %q", id)}
	}
	p := m.provider(t.Provider)
	if p == nil {
		return State{}, unknownProvider(t.Provider)
	}
	login, err := m.store.login(id)
	if err != nil {
		return State{}, err
	}
	changed, err := fill(p, login, fields)
	if err != nil {
		return State{}, err
	}
	if changed {
		if err := m.store.save(id, placeOf(login), login); err != nil {
			return State{}, err
		}
	}
	w := m.wire(id)
	m.mu.Lock()
	w.fail = nil
	m.mu.Unlock()
	return m.State(), nil
}

// Forget removes tunnel id and its login. Runs of the jobs that went through
// it fail until they are given another.
func (m *Manager) Forget(id string) (State, error) {
	t, ok := m.store.tunnel(id)
	if !ok {
		return State{}, &Refusal{Status: http.StatusNotFound, Code: "vpn-unknown", Text: fmt.Sprintf("no VPN %q", id)}
	}
	login, _ := m.store.login(id)
	if err := m.store.forget(id); err != nil {
		return State{}, err
	}
	if p := m.provider(t.Provider); p != nil && p.forget != nil && len(login) > 0 {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			p.forget(ctx, login)
		}()
	}
	return m.State(), nil
}

// Test brings tunnel up the way a run would, asks through it which address
// the traffic leaves by, and lets it go again.
func (m *Manager) Test(ctx context.Context, tunnel string) (State, error) {
	lease, err := m.Acquire(ctx, tunnel, "")
	if err != nil {
		return m.State(), err
	}
	ip, err := m.lookUpExitIP(ctx, lease.Proxy())
	lease.Release()
	if err != nil {
		m.opts.Logf("vpn: exit address: %v", err)
	}
	m.mu.Lock()
	lease.b.w.exitIP = ip
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

// Close takes every tunnel down, whoever still holds it, as the program ends.
func (m *Manager) Close() {
	m.mu.Lock()
	var ups []*bringUp
	for _, w := range m.wires {
		if w.up != nil {
			ups = append(ups, w.up)
			w.up = nil
		}
	}
	m.mu.Unlock()
	for _, b := range ups {
		m.takeDown(b)
	}
}
