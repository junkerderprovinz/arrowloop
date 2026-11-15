package certpin

import (
	"bufio"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// The relay is how a pin reaches rclone, which builds the TLS settings of its
// HTTP connections itself and lets nothing change how they check a
// certificate. A pinned target's connections go to the relay as to a proxy.
// The relay holds the server to the pin and passes the traffic on under a
// certificate of its own, from an authority only those connections trust.
type relay struct {
	addr   string
	caFile string
	ca     *x509.Certificate
	caKey  crypto.Signer

	mu       sync.Mutex
	users    map[string]string // proxy user by pin and roots
	sessions map[string]*session
	leaves   map[string]*tls.Certificate // by host
}

// session is what the relay holds the servers of one proxy user to.
type session struct {
	pin string
	// roots are the authorities a certificate may also come from, nil for the
	// system's.
	roots *x509.CertPool
}

// connectWait bounds everything before the traffic flows: the request, the
// connection to the server and both handshakes.
const connectWait = time.Minute

var shared struct {
	once  sync.Once
	relay *relay
	err   error
}

// Relay returns the proxy address that holds a connection to pin, and the
// file with the authority the connection then has to trust in place of any
// other. A certificate from one of the authorities in the roots files, or the
// system's where there are none, still passes as it would without a pin.
func Relay(pin string, roots []string) (proxy, authority string, err error) {
	shared.once.Do(func() { shared.relay, shared.err = start() })
	if shared.err != nil {
		return "", "", fmt.Errorf("start the relay for trusted certificates: %w", shared.err)
	}
	r := shared.relay
	user, err := r.session(pin, roots)
	if err != nil {
		return "", "", err
	}
	return "http://" + user + "@" + r.addr, r.caFile, nil
}

func start() (*relay, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	tmpl := &x509.Certificate{
		SerialNumber:          serial(),
		Subject:               pkix.Name{CommonName: "ArrowLoop relay"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		IsCA:                  true,
		BasicConstraintsValid: true,
		MaxPathLenZero:        true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, key.Public(), key)
	if err != nil {
		return nil, err
	}
	ca, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, err
	}
	// rclone reads its authorities from files. The key stays in memory, so
	// the file is worth nothing once this process ends.
	f, err := os.CreateTemp("", "arrowloop-relay-*.pem")
	if err != nil {
		return nil, err
	}
	if err := pem.Encode(f, &pem.Block{Type: "CERTIFICATE", Bytes: der}); err != nil {
		f.Close()
		return nil, err
	}
	if err := f.Close(); err != nil {
		return nil, err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	r := &relay{
		addr:     ln.Addr().String(),
		caFile:   f.Name(),
		ca:       ca,
		caKey:    key,
		users:    map[string]string{},
		sessions: map[string]*session{},
		leaves:   map[string]*tls.Certificate{},
	}
	go r.serve(ln)
	return r, nil
}

func serial() *big.Int {
	n, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	return n
}

func (r *relay) session(pin string, roots []string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := pin + "\x00" + strings.Join(roots, "\x00")
	if user, ok := r.users[key]; ok {
		return user, nil
	}
	pool, err := readRoots(roots)
	if err != nil {
		return "", err
	}
	raw := make([]byte, 16)
	_, _ = rand.Read(raw)
	user := hex.EncodeToString(raw)
	r.users[key] = user
	r.sessions[user] = &session{pin: pin, roots: pool}
	return user, nil
}

// readRoots reads authorities the way rclone reads its ca_cert files.
func readRoots(files []string) (*x509.CertPool, error) {
	if len(files) == 0 {
		return nil, nil
	}
	pool := x509.NewCertPool()
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		if !pool.AppendCertsFromPEM(data) {
			return nil, fmt.Errorf("no certificates in %s", file)
		}
	}
	return pool, nil
}

func (r *relay) serve(ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go r.handle(conn)
	}
}

func (r *relay) handle(conn net.Conn) {
	defer conn.Close()
	deadline := time.Now().Add(connectWait)
	_ = conn.SetDeadline(deadline)
	in := bufio.NewReader(conn)
	req, err := http.ReadRequest(in)
	if err != nil {
		return
	}
	s := r.sessionOf(req)
	switch {
	case req.Method != http.MethodConnect:
		answer(conn, http.StatusMethodNotAllowed, "Method Not Allowed")
		return
	case s == nil:
		answer(conn, http.StatusProxyAuthRequired, "Proxy Authentication Required")
		return
	case in.Buffered() > 0:
		// A client waits for the answer before its handshake.
		return
	}
	host, _, err := net.SplitHostPort(req.Host)
	if err != nil {
		answer(conn, http.StatusBadRequest, "Bad Request")
		return
	}
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()
	server, err := s.dial(ctx, req.Host, host)
	if err != nil {
		answer(conn, http.StatusBadGateway, oneLine(err.Error()))
		return
	}
	defer server.Close()
	leaf, err := r.leaf(host)
	if err != nil {
		answer(conn, http.StatusInternalServerError, oneLine(err.Error()))
		return
	}
	answer(conn, http.StatusOK, "Connection Established")
	client := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{*leaf}, NextProtos: []string{"http/1.1"}})
	if err := client.Handshake(); err != nil {
		return
	}
	_ = conn.SetDeadline(time.Time{})
	pipe(client, server)
}

// sessionOf reads the proxy user a request signs in with.
func (r *relay) sessionOf(req *http.Request) *session {
	probe := http.Request{Header: http.Header{"Authorization": req.Header.Values("Proxy-Authorization")}}
	user, _, ok := probe.BasicAuth()
	if !ok {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sessions[user]
}

func answer(w io.Writer, code int, reason string) {
	fmt.Fprintf(w, "HTTP/1.1 %d %s\r\nContent-Length: 0\r\n\r\n", code, reason)
}

// oneLine keeps an error fit for a status line, where rclone reads it.
func oneLine(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' {
			return ' '
		}
		return r
	}, s)
}

// pipe passes traffic both ways until either side is done. The caller closes
// both, which ends the other direction.
func pipe(a, b net.Conn) {
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(a, b); done <- struct{}{} }()
	go func() { _, _ = io.Copy(b, a); done <- struct{}{} }()
	<-done
}

// leaf is the relay's certificate for host, made once per host.
func (r *relay) leaf(host string) (*tls.Certificate, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.leaves[host]; ok {
		return c, nil
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	tmpl := &x509.Certificate{
		SerialNumber: serial(),
		Subject:      pkix.Name{CommonName: host},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     r.ca.NotAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	if ip := net.ParseIP(host); ip != nil {
		tmpl.IPAddresses = []net.IP{ip}
	} else {
		tmpl.DNSNames = []string{host}
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, r.ca, key.Public(), r.caKey)
	if err != nil {
		return nil, err
	}
	c := &tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
	r.leaves[host] = c
	return c, nil
}

func (s *session) dial(ctx context.Context, addr, host string) (*tls.Conn, error) {
	d := &tls.Dialer{Config: &tls.Config{
		ServerName: host,
		NextProtos: []string{"http/1.1"},
		// The usual check would refuse the certificate the pin is for, so
		// VerifyConnection does all of it, the usual check included.
		InsecureSkipVerify: true,
		VerifyConnection: func(state tls.ConnectionState) error {
			return s.verify(host, state.PeerCertificates)
		},
	}}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	return conn.(*tls.Conn), nil
}

// verify passes a certificate an authority vouches for, as the usual check
// would, and otherwise only the pinned one, whatever host and dates it names.
func (s *session) verify(host string, chain []*x509.Certificate) error {
	leaf := chain[0]
	intermediates := x509.NewCertPool()
	for _, c := range chain[1:] {
		intermediates.AddCert(c)
	}
	if _, err := leaf.Verify(x509.VerifyOptions{DNSName: host, Roots: s.roots, Intermediates: intermediates}); err == nil {
		return nil
	}
	if Same(Fingerprint(leaf.Raw), s.pin) {
		return nil
	}
	refused := &Untrusted{Certificate: Describe(leaf), Changed: true}
	remember(refused.Certificate)
	return refused
}

// refusedCerts keeps the certificates the relay refused, since their details
// reach rclone's error only as a fingerprint.
var refusedCerts struct {
	mu    sync.Mutex
	byFP  map[string]Certificate
	order []string
}

const keptRefusals = 32

func remember(c Certificate) {
	refusedCerts.mu.Lock()
	defer refusedCerts.mu.Unlock()
	if refusedCerts.byFP == nil {
		refusedCerts.byFP = map[string]Certificate{}
	}
	if _, ok := refusedCerts.byFP[c.Fingerprint]; !ok {
		refusedCerts.order = append(refusedCerts.order, c.Fingerprint)
	}
	refusedCerts.byFP[c.Fingerprint] = c
	for len(refusedCerts.order) > keptRefusals {
		delete(refusedCerts.byFP, refusedCerts.order[0])
		refusedCerts.order = refusedCerts.order[1:]
	}
}

func recall(fingerprint string) Certificate {
	refusedCerts.mu.Lock()
	defer refusedCerts.mu.Unlock()
	if c, ok := refusedCerts.byFP[fingerprint]; ok {
		return c
	}
	return Certificate{Fingerprint: fingerprint}
}
