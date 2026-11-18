package certpin

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"
)

func authority(t *testing.T) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Heimnetz CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return ca, key
}

func issued(t *testing.T, ca *x509.Certificate, caKey *ecdsa.PrivateKey, host string) *x509.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		DNSNames:     []string{host},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca, &key.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	c, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestVerifyPassesAnAuthorityOrThePinAndNothingElse(t *testing.T) {
	ca, caKey := authority(t)
	roots := x509.NewCertPool()
	roots.AddCert(ca)
	vouched := issued(t, ca, caKey, "dav.lan")
	own := selfSigned(t, &x509.Certificate{DNSNames: []string{"dav.lan"}})
	other := selfSigned(t, &x509.Certificate{DNSNames: []string{"dav.lan"}})

	for _, tc := range []struct {
		name  string
		host  string
		chain []*x509.Certificate
		pin   string
		roots *x509.CertPool
		pass  bool
	}{
		{"a certificate from a trusted authority for the host passes", "dav.lan", []*x509.Certificate{vouched}, "", roots, true},
		{"the chain may carry its authority along", "dav.lan", []*x509.Certificate{vouched, ca}, "", roots, true},
		{"a self-signed certificate passes with its own fingerprint", "dav.lan", []*x509.Certificate{own}, Fingerprint(own.Raw), nil, true},
		{"the pin is matched however it was typed", "dav.lan", []*x509.Certificate{own}, "  " + strings.ToLower(strings.ReplaceAll(Fingerprint(own.Raw), ":", "")), nil, true},
		{"a self-signed certificate without a pin is refused", "dav.lan", []*x509.Certificate{own}, "", nil, false},
		{"another certificate's fingerprint is refused", "dav.lan", []*x509.Certificate{own}, Fingerprint(other.Raw), nil, false},
		{"an empty pin matches nothing", "dav.lan", []*x509.Certificate{own}, "::", nil, false},
		{"a trusted certificate for another host is refused", "files.lan", []*x509.Certificate{vouched}, "", roots, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &session{pin: tc.pin, roots: tc.roots}
			err := s.verify(tc.host, tc.chain)
			if tc.pass {
				if err != nil {
					t.Fatalf("refused: %v", err)
				}
				return
			}
			var refused *Untrusted
			if !errors.As(err, &refused) {
				t.Fatalf("got %v, want an *Untrusted", err)
			}
			if want := Fingerprint(tc.chain[0].Raw); refused.Fingerprint != want {
				t.Fatalf("refusal names %s, want the leaf %s", refused.Fingerprint, want)
			}
		})
	}
}
