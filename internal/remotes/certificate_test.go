package remotes

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/certpin"
	rclonefs "github.com/rclone/rclone/fs"
	"golang.org/x/net/webdav"
)

// serverCert makes a certificate for nextcloud.lan alone, signed by itself or
// by ca, the way a self-hosted server's own certificate is often made. The
// tests reach it at 127.0.0.1, which the self-signed one does not name.
func serverCert(t *testing.T, ca *tls.Certificate, ips ...net.IP) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	serial, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "nextcloud.lan"},
		DNSNames:     []string{"nextcloud.lan"},
		IPAddresses:  ips,
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	parent, signer := tmpl, any(key)
	if ca != nil {
		parent, signer = ca.Leaf, ca.PrivateKey
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, &key.PublicKey, signer)
	if err != nil {
		t.Fatal(err)
	}
	leaf, _ := x509.ParseCertificate(der)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key, Leaf: leaf}
}

// authority makes a certificate authority and a file rclone's ca_cert can
// name, standing in for one the system trusts.
func authority(t *testing.T) (tls.Certificate, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test Authority"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	leaf, _ := x509.ParseCertificate(der)
	file := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(file, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key, Leaf: leaf}, file
}

// davServer is a WebDAV server that shows cert and wants someone/letmein.
func davServer(t *testing.T, cert tls.Certificate) string {
	t.Helper()
	dav := &webdav.Handler{FileSystem: webdav.NewMemFS(), LockSystem: webdav.NewMemLS()}
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if user, pass, _ := r.BasicAuth(); user != "someone" || pass != "letmein" {
			w.Header().Set("WWW-Authenticate", `Basic realm="dav"`)
			http.Error(w, "sign in", http.StatusUnauthorized)
			return
		}
		dav.ServeHTTP(w, r)
	}))
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{cert}}
	srv.StartTLS()
	t.Cleanup(srv.Close)
	return srv.URL
}

func davForm(url string) map[string]string {
	return map[string]string{"url": url, "vendor": "other", "user": "someone", "pass": "letmein"}
}

func TestAnUnknownCertificateIsRefusedWithItsFingerprint(t *testing.T) {
	ownConfig(t)
	cert := serverCert(t, nil)

	_, err := Try(context.Background(), "", "webdav", davForm(davServer(t, cert)))
	got, ok := certpin.Find(err)
	if !ok {
		t.Fatalf("the test answered %v, want a refused certificate", err)
	}
	if want := certpin.Fingerprint(cert.Leaf.Raw); got.Fingerprint != want {
		t.Fatalf("the refusal shows %s, want %s", got.Fingerprint, want)
	}
	if got.Subject != "nextcloud.lan" || got.Changed {
		t.Fatalf("the refusal reads %+v, want the server's name and no earlier certificate", got)
	}
}

func TestATrustedCertificatePassesThoughItNamesAnotherHost(t *testing.T) {
	ownConfig(t)
	cert := serverCert(t, nil)
	form := davForm(davServer(t, cert))
	form[CertificateKey] = certpin.Fingerprint(cert.Leaf.Raw)

	if _, err := Try(context.Background(), "", "webdav", form); err != nil {
		t.Fatalf("the trusted certificate was refused: %v", err)
	}
}

func TestASavedTargetKeepsTrustingItsCertificate(t *testing.T) {
	cert := serverCert(t, nil)
	form := davForm(davServer(t, cert))
	form[CertificateKey] = certpin.Fingerprint(cert.Leaf.Raw)
	saved(t, "cloud", "webdav", form)

	if err := Check(context.Background(), "cloud"); err != nil {
		t.Fatalf("the saved target was refused: %v", err)
	}
}

func TestAnotherCertificateIsRefusedOnceOneIsTrusted(t *testing.T) {
	ownConfig(t)
	trusted := serverCert(t, nil)
	swapped := serverCert(t, nil)
	form := davForm(davServer(t, swapped))
	form[CertificateKey] = certpin.Fingerprint(trusted.Leaf.Raw)

	_, err := Try(context.Background(), "", "webdav", form)
	got, ok := certpin.Find(err)
	if !ok {
		t.Fatalf("the test answered %v, want a refused certificate", err)
	}
	if want := certpin.Fingerprint(swapped.Leaf.Raw); got.Fingerprint != want || got.Subject != "nextcloud.lan" || !got.Changed {
		t.Fatalf("the refusal reads %+v, want the new certificate %s marked as changed", got, want)
	}
}

func TestACertificateAnAuthorityVouchesForNeedsNoTrust(t *testing.T) {
	ca, file := authority(t)
	cert := serverCert(t, &ca, net.IPv4(127, 0, 0, 1))
	url := davServer(t, cert)
	ctx, ci := rclonefs.AddConfig(context.Background())
	ci.CaCert = []string{file}

	for _, pin := range []string{"", certpin.Fingerprint(serverCert(t, nil).Leaf.Raw)} {
		ownConfig(t)
		form := davForm(url)
		form[CertificateKey] = pin
		if _, err := Try(ctx, "", "webdav", form); err != nil {
			t.Fatalf("with the trusted fingerprint %q the valid certificate was refused: %v", pin, err)
		}
	}
}

// Trusting a certificate changes nothing about where the password goes, so
// the test of the form that trusts it still uses the saved one.
func TestTrustingACertificateKeepsTheSavedPassword(t *testing.T) {
	cert := serverCert(t, nil)
	url := davServer(t, cert)
	saved(t, "cloud", "webdav", davForm(url))

	form := davForm(url)
	form["pass"] = Placeholder
	form[CertificateKey] = certpin.Fingerprint(cert.Leaf.Raw)
	if _, err := Try(context.Background(), "cloud", "webdav", form); err != nil {
		t.Fatalf("the test with the saved password failed: %v", err)
	}
}

func TestOnlyABackendThePinReachesOffersToTrustACertificate(t *testing.T) {
	for _, b := range Backends() {
		if want := b.Name == "webdav"; b.TrustsCertificate != want {
			t.Errorf("%s offers to trust a certificate: %v, want %v", b.Name, b.TrustsCertificate, want)
		}
	}
}
