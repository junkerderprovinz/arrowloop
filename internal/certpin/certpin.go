// Package certpin lets a target trust one server certificate that no
// authority vouches for, such as the one a self-hosted Nextcloud made for
// itself, by its SHA-256 fingerprint.
package certpin

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Certificate is what a person needs to decide whether to trust a server's
// certificate.
type Certificate struct {
	Fingerprint string    `json:"fingerprint"`
	Subject     string    `json:"subject"`
	Issuer      string    `json:"issuer"`
	NotBefore   time.Time `json:"notBefore"`
	NotAfter    time.Time `json:"notAfter"`
}

// Describe reads a certificate for the screen.
func Describe(c *x509.Certificate) Certificate {
	return Certificate{
		Fingerprint: Fingerprint(c.Raw),
		Subject:     name(c.Subject.CommonName, c.Subject.String()),
		Issuer:      name(c.Issuer.CommonName, c.Issuer.String()),
		NotBefore:   c.NotBefore,
		NotAfter:    c.NotAfter,
	}
}

func name(common, full string) string {
	if common != "" {
		return common
	}
	return full
}

// Fingerprint is the SHA-256 of a certificate in the colon-separated form
// browsers and openssl print.
func Fingerprint(der []byte) string {
	sum := sha256.Sum256(der)
	parts := make([]string, len(sum))
	for i, b := range sum {
		parts[i] = fmt.Sprintf("%02X", b)
	}
	return strings.Join(parts, ":")
}

// Same reports whether two fingerprints name the same certificate, however
// each was typed or pasted.
func Same(a, b string) bool {
	plain := strings.NewReplacer(":", "", " ", "")
	a, b = plain.Replace(a), plain.Replace(b)
	return a != "" && strings.EqualFold(a, b)
}

// Untrusted is a server certificate the check refused.
type Untrusted struct {
	Certificate
	// Changed says the target trusts another certificate, so the server
	// either got a new one or someone is listening in between.
	Changed bool `json:"changed"`
}

func (u *Untrusted) Error() string {
	if u.Changed {
		return changedText + u.Fingerprint
	}
	return "certificate not trusted, SHA-256 " + u.Fingerprint
}

// changedText leads the words the relay refuses a connection with. It reaches
// rclone only as text, so Find reads the fingerprint back out of it.
const changedText = "certificate changed, SHA-256 "

var changed = regexp.MustCompile(regexp.QuoteMeta(changedText) + `([0-9A-F]{2}(?::[0-9A-F]{2}){31})`)

// Find reports the certificate a failed connection refused, if that is why
// it failed.
func Find(err error) (*Untrusted, bool) {
	if err == nil {
		return nil, false
	}
	var refused *Untrusted
	if errors.As(err, &refused) {
		return refused, true
	}
	var unverified *tls.CertificateVerificationError
	if errors.As(err, &unverified) && len(unverified.UnverifiedCertificates) > 0 {
		return &Untrusted{Certificate: Describe(unverified.UnverifiedCertificates[0])}, true
	}
	if m := changed.FindStringSubmatch(err.Error()); m != nil {
		return &Untrusted{Certificate: recall(m[1]), Changed: true}, true
	}
	return nil, false
}
