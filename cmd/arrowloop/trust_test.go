package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rclone/rclone/fs/fshttp"
)

// The phone app writes the authorities somebody installed in Android's
// settings to a file and names it in SSL_CERT_FILE, since the engine cannot
// read the folder Android keeps them in (see Authorities.kt). Go loads the
// store once per process, so every case runs in a process of its own.

const trustDirVar = "ARROWLOOP_TEST_SYSTEM_CERTS"

// authority is a certificate authority with a server whose certificate it
// signed.
type authority struct {
	pem []byte
	url string
}

func newAuthority(t *testing.T, name string) authority {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: name + " CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leafTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		IPAddresses:  []net.IP{net.IPv4(127, 0, 0, 1)},
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTemplate, ca, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	server.TLS = &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{leafDER}, PrivateKey: leafKey}}}
	// The refused cases end in handshake errors the server would log.
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	t.Cleanup(server.Close)

	return authority{
		pem: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}),
		url: server.URL,
	}
}

// inFreshProcess runs TestTrustInAFreshProcess with the system store in dir
// and the user's authorities in userFile, if any.
func inFreshProcess(t *testing.T, dir, userFile string, trusted, refused []authority) {
	t.Helper()
	urls := func(list []authority) string {
		out := make([]string, len(list))
		for i, a := range list {
			out[i] = a.url
		}
		return strings.Join(out, " ")
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestTrustInAFreshProcess$", "-test.v")
	cmd.Env = append(os.Environ(),
		trustDirVar+"="+dir,
		"SSL_CERT_DIR=",
		"SSL_CERT_FILE="+userFile,
		"ARROWLOOP_TEST_TRUSTED="+urls(trusted),
		"ARROWLOOP_TEST_REFUSED="+urls(refused),
	)
	out, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "--- PASS: TestTrustInAFreshProcess") {
		t.Fatalf("%v\n%s", err, out)
	}
}

func TestAnAuthorityInstalledOnThePhoneIsTrustedBesideTheSystemOnes(t *testing.T) {
	system := newAuthority(t, "system")
	installed := newAuthority(t, "installed")
	stranger := newAuthority(t, "stranger")

	dir := t.TempDir()
	systemDir := filepath.Join(dir, "cacerts")
	if err := os.Mkdir(systemDir, 0o700); err != nil {
		t.Fatal(err)
	}
	// Android names each file after the subject's hash.
	if err := os.WriteFile(filepath.Join(systemDir, "1a2b3c4d.0"), system.pem, 0o600); err != nil {
		t.Fatal(err)
	}
	userFile := filepath.Join(dir, "user-cas.pem")
	if err := os.WriteFile(userFile, installed.pem, 0o600); err != nil {
		t.Fatal(err)
	}

	t.Run("with the app's file", func(t *testing.T) {
		inFreshProcess(t, systemDir, userFile, []authority{system, installed}, []authority{stranger})
	})
	t.Run("without it", func(t *testing.T) {
		inFreshProcess(t, systemDir, "", []authority{system}, []authority{installed, stranger})
	})
}

// TestTrustInAFreshProcess is the half that runs in the process started
// above, through the client rclone builds for every HTTPS remote.
func TestTrustInAFreshProcess(t *testing.T) {
	dir := os.Getenv(trustDirVar)
	if dir == "" {
		t.Skip("started by TestAnAuthorityInstalledOnThePhoneIsTrustedBesideTheSystemOnes")
	}
	androidCertDirs = []string{dir}
	applyAndroidEnvironment()

	client := fshttp.NewClient(context.Background())
	for _, url := range strings.Fields(os.Getenv("ARROWLOOP_TEST_TRUSTED")) {
		resp, err := client.Get(url)
		if err != nil {
			t.Errorf("%s was refused: %v", url, err)
			continue
		}
		resp.Body.Close()
	}
	for _, url := range strings.Fields(os.Getenv("ARROWLOOP_TEST_REFUSED")) {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			t.Errorf("%s was trusted without its authority being installed", url)
		}
	}
}
