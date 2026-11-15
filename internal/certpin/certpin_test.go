package certpin

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"testing"
	"time"
)

func selfSigned(t *testing.T, tmpl *x509.Certificate) *x509.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl.SerialNumber = big.NewInt(1)
	tmpl.NotBefore = time.Now().Add(-time.Hour)
	tmpl.NotAfter = time.Now().Add(time.Hour)
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	c, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestACertificateWithoutACommonNameIsNamedAfterItsFirstHost(t *testing.T) {
	c := selfSigned(t, &x509.Certificate{DNSNames: []string{"dav.lan", "files.lan"}})
	got := Describe(c)
	if got.Subject != "dav.lan" || got.Issuer != "dav.lan" {
		t.Fatalf("subject %q, issuer %q, want dav.lan for both", got.Subject, got.Issuer)
	}
}

func TestACertificateForAnAddressIsNamedAfterIt(t *testing.T) {
	c := selfSigned(t, &x509.Certificate{IPAddresses: []net.IP{net.ParseIP("192.168.20.87")}})
	if got := Describe(c).Subject; got != "192.168.20.87" {
		t.Fatalf("subject %q, want 192.168.20.87", got)
	}
}

func TestACommonNameStillComesFirst(t *testing.T) {
	c := selfSigned(t, &x509.Certificate{Subject: pkix.Name{CommonName: "nextcloud.heimnetz"}, DNSNames: []string{"dav.lan"}})
	if got := Describe(c).Subject; got != "nextcloud.heimnetz" {
		t.Fatalf("subject %q, want nextcloud.heimnetz", got)
	}
}
