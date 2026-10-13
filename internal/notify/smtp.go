package notify

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// SMTP sends each message as a plain-text mail.
type SMTP struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	// To takes several addresses, separated by commas or semicolons.
	To string
	// TLS is "starttls" (the default), "tls" for a connection encrypted from
	// the first byte, or "none".
	TLS string

	// roots replaces the system's certificates in tests.
	roots *x509.CertPool
}

// Describe names the recipients and the server.
func (s *SMTP) Describe() string { return "mail to " + s.To + " via " + s.Host }

func (s *SMTP) port() int {
	if s.Port != 0 {
		return s.Port
	}
	if strings.EqualFold(s.TLS, "tls") {
		return 465
	}
	return 587
}

func (s *SMTP) tlsConfig() *tls.Config {
	return &tls.Config{ServerName: s.Host, RootCAs: s.roots, MinVersion: tls.VersionTLS12}
}

// Send delivers the message. Logging in is plain auth, and only when a user
// name is set.
func (s *SMTP) Send(ctx context.Context, msg Message) error {
	if s.Host == "" || s.From == "" || s.To == "" {
		return errors.New("mail needs a server, a sender and a recipient")
	}
	ctx, cancel := context.WithTimeout(ctx, SendTimeout)
	defer cancel()
	deadline, _ := ctx.Deadline()

	addr := net.JoinHostPort(s.Host, strconv.Itoa(s.port()))
	dialer := &net.Dialer{}
	var conn net.Conn
	var err error
	if strings.EqualFold(s.TLS, "tls") {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: s.tlsConfig()}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("reach %s: %w", addr, err)
	}
	// The whole conversation shares the deadline, so a server that stops
	// answering halfway cannot hold the run's report forever.
	conn.SetDeadline(deadline)

	c, err := smtp.NewClient(conn, s.Host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()

	if s.TLS == "" || strings.EqualFold(s.TLS, "starttls") {
		// Falling back to cleartext would hand the password to whoever
		// stripped STARTTLS from the server's answer. Cleartext is "none".
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return errors.New("the server does not offer STARTTLS; choose TLS or none as the encryption")
		}
		if err := c.StartTLS(s.tlsConfig()); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
	}
	if s.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", s.Username, s.Password, s.Host)); err != nil {
			return fmt.Errorf("log in: %w", err)
		}
	}
	if err := c.Mail(s.From); err != nil {
		return fmt.Errorf("sender: %w", err)
	}
	for _, to := range recipients(s.To) {
		if err := c.Rcpt(to); err != nil {
			return fmt.Errorf("recipient %s: %w", to, err)
		}
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(s.mail(scrubbed(msg), time.Now())); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

// mail renders the message as RFC 5322 text with the subject as the subject.
func (s *SMTP) mail(msg Message, now time.Time) []byte {
	var b strings.Builder
	b.WriteString("From: " + s.From + "\r\n")
	b.WriteString("To: " + strings.Join(recipients(s.To), ", ") + "\r\n")
	b.WriteString("Subject: " + headerSafe(msg.Subject) + "\r\n")
	b.WriteString("Date: " + now.Format(time.RFC1123Z) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("\r\n")
	b.WriteString(strings.ReplaceAll(strings.ReplaceAll(msg.Body, "\r\n", "\n"), "\n", "\r\n"))
	b.WriteString("\r\n")
	return []byte(b.String())
}

// headerSafe keeps a job name with a line break in it from writing headers of
// its own, and encodes one that is not plain ASCII.
func headerSafe(s string) string {
	return mime.QEncoding.Encode("utf-8", strings.NewReplacer("\r", " ", "\n", " ").Replace(s))
}

// recipients splits a list separated by commas or semicolons.
func recipients(to string) []string {
	var out []string
	for _, f := range strings.FieldsFunc(to, func(r rune) bool { return r == ',' || r == ';' }) {
		if t := strings.TrimSpace(f); t != "" {
			out = append(out, t)
		}
	}
	return out
}
