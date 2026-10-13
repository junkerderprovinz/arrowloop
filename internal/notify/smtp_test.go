package notify

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// mailServer is just enough of an SMTP server to take one mail at a time.
type mailServer struct {
	addr  string
	port  int
	roots *x509.CertPool

	mu       sync.Mutex
	commands []string
	data     string
	login    string
}

type mailOptions struct {
	starttls bool // offers STARTTLS
	implicit bool // speaks TLS from the first byte
	refuse   bool // refuses every login
}

func newMailServer(t *testing.T, opt mailOptions) *mailServer {
	t.Helper()
	// httptest makes a certificate for 127.0.0.1 and a client that trusts it.
	hs := httptest.NewUnstartedServer(http.NotFoundHandler())
	hs.StartTLS()
	certs := hs.TLS.Certificates
	roots := hs.Client().Transport.(*http.Transport).TLSClientConfig.RootCAs
	hs.Close()
	serverTLS := &tls.Config{Certificates: certs}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	m := &mailServer{addr: ln.Addr().String(), port: ln.Addr().(*net.TCPAddr).Port, roots: roots}

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			if opt.implicit {
				conn = tls.Server(conn, serverTLS)
			}
			go m.serve(conn, opt, serverTLS)
		}
	}()
	return m
}

func (m *mailServer) serve(conn net.Conn, opt mailOptions, serverTLS *tls.Config) {
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(10 * time.Second))
	r := bufio.NewReader(conn)
	say := func(s string) { conn.Write([]byte(s + "\r\n")) }
	say("220 mail.test ready")
	secure := opt.implicit
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		verb := strings.ToUpper(strings.Fields(line + " x")[0])
		m.mu.Lock()
		m.commands = append(m.commands, verb)
		m.mu.Unlock()
		switch verb {
		case "EHLO":
			say("250-mail.test")
			if opt.starttls && !secure {
				say("250-STARTTLS")
			}
			say("250 AUTH PLAIN")
		case "STARTTLS":
			say("220 go ahead")
			tc := tls.Server(conn, serverTLS)
			if tc.Handshake() != nil {
				return
			}
			conn, r, secure = tc, bufio.NewReader(tc), true
			say = func(s string) { tc.Write([]byte(s + "\r\n")) }
		case "AUTH":
			raw, _ := base64.StdEncoding.DecodeString(strings.Fields(line)[2])
			m.mu.Lock()
			m.login = string(raw)
			m.mu.Unlock()
			if opt.refuse {
				say("535 5.7.8 credentials rejected")
			} else {
				say("235 ok")
			}
		case "MAIL", "RCPT":
			say("250 ok")
		case "DATA":
			say("354 go on")
			var b strings.Builder
			for {
				l, err := r.ReadString('\n')
				if err != nil || l == ".\r\n" {
					break
				}
				b.WriteString(l)
			}
			m.mu.Lock()
			m.data = b.String()
			m.mu.Unlock()
			say("250 queued")
		case "QUIT":
			say("221 bye")
			return
		default:
			say("500 what")
		}
	}
}

func (m *mailServer) seen() (commands []string, data, login string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.commands...), m.data, m.login
}

func (m *mailServer) mailer(tlsMode string) *SMTP {
	return &SMTP{
		Host: "127.0.0.1", Port: m.port, TLS: tlsMode, roots: m.roots,
		From: "arrowloop@example.org", To: "a@example.org; b@example.org",
	}
}

func TestMailArrivesOverEveryKindOfConnection(t *testing.T) {
	for _, tc := range []struct {
		mode string
		opt  mailOptions
	}{
		{"none", mailOptions{}},
		{"", mailOptions{starttls: true}},
		{"starttls", mailOptions{starttls: true}},
		{"tls", mailOptions{implicit: true}},
	} {
		t.Run("tls "+tc.mode, func(t *testing.T) {
			srv := newMailServer(t, tc.opt)
			s := srv.mailer(tc.mode)
			s.Username, s.Password = "arrowloop", "pw"
			if err := s.Send(context.Background(), Message{Subject: "ArrowLoop: Fotos für Oma failed", Body: "line one\nline two", Failed: true}); err != nil {
				t.Fatalf("send: %v", err)
			}
			commands, data, login := srv.seen()
			if strings.Count(strings.Join(commands, " "), "RCPT") != 2 {
				t.Errorf("both recipients should get it: %v", commands)
			}
			if login != "\x00arrowloop\x00pw" {
				t.Errorf("logged in as %q", login)
			}
			for _, want := range []string{
				"From: arrowloop@example.org\r\n",
				"To: a@example.org, b@example.org\r\n",
				"Subject: =?utf-8?q?",
				"Content-Type: text/plain; charset=utf-8\r\n",
				"\r\nline one\r\nline two\r\n",
			} {
				if !strings.Contains(data, want) {
					t.Errorf("the mail lacks %q:\n%s", want, data)
				}
			}
		})
	}
}

// Somebody who strips STARTTLS from the server's greeting must not be handed
// the password in cleartext.
func TestMailDoesNotFallBackToCleartext(t *testing.T) {
	srv := newMailServer(t, mailOptions{})
	s := srv.mailer("starttls")
	s.Username, s.Password = "arrowloop", "SECRETPW"
	err := s.Send(context.Background(), failed)
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("err = %v, want one about STARTTLS", err)
	}
	commands, _, login := srv.seen()
	if login != "" || strings.Contains(strings.Join(commands, " "), "AUTH") {
		t.Errorf("the login went out unencrypted: %v", commands)
	}
}

func TestARefusedLoginSaysSoWithoutThePassword(t *testing.T) {
	srv := newMailServer(t, mailOptions{refuse: true})
	s := srv.mailer("none")
	s.Username, s.Password = "arrowloop", "SECRETPW"
	err := s.Send(context.Background(), failed)
	if err == nil || !strings.Contains(err.Error(), "535") {
		t.Fatalf("err = %v, want the server's refusal", err)
	}
	if strings.Contains(err.Error(), "SECRETPW") {
		t.Errorf("the error carries the password: %v", err)
	}
}

func TestMailToNobodyIsRefusedBeforeDialling(t *testing.T) {
	if err := (&SMTP{Host: "127.0.0.1", From: "a@example.org"}).Send(context.Background(), failed); err == nil {
		t.Fatal("a mail with no recipient was sent")
	}
}

func TestAMailServerThatIsNotThereFailsInTime(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()

	start := time.Now()
	err = (&SMTP{Host: "127.0.0.1", Port: port, TLS: "none", From: "a@example.org", To: "b@example.org"}).Send(context.Background(), failed)
	if err == nil || !strings.Contains(err.Error(), strconv.Itoa(port)) {
		t.Fatalf("err = %v, want one naming the address", err)
	}
	if time.Since(start) > SendTimeout {
		t.Error("the send outlived its own limit")
	}
}

// A server that greets and then says nothing more must not hold the report
// past the limit the caller set.
func TestASilentMailServerIsGivenUpOn(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err == nil {
			defer conn.Close()
			time.Sleep(5 * time.Second)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	err = (&SMTP{Host: "127.0.0.1", Port: ln.Addr().(*net.TCPAddr).Port, TLS: "none", From: "a@example.org", To: "b@example.org"}).Send(ctx, failed)
	if err == nil {
		t.Fatal("a server that never greeted took the mail")
	}
	if time.Since(start) > 3*time.Second {
		t.Errorf("waited %s for a silent server", time.Since(start))
	}
}
