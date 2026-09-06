package scenario

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"github.com/rclone/gofakes3"
	"github.com/rclone/gofakes3/s3mem"
	"golang.org/x/crypto/ssh"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/obscure"

	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/s3"
	_ "github.com/rclone/rclone/backend/sftp"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// The two backends this product is sold on had never once been run. Every test
// in the repository synced one local folder to another, so "reaches SFTP and
// S3" was a claim resting entirely on rclone being rclone.
//
// Both servers below are real and run in this process: gofakes3 speaks the S3
// API that rclone's own `serve s3` speaks, and pkg/sftp speaks SFTP over a real
// SSH transport. No credential, no container, no external host. What is being
// tested is not the servers, it is the engine's own assumptions meeting a
// backend that is not a filesystem.

// startS3 runs an S3 server and returns the rclone remote string that reaches
// it. Path style is forced because a virtual-host-style address would need DNS
// for a bucket that exists only in this process.
func startS3(t *testing.T, bucket string) string {
	t.Helper()
	const key, secret = "arrowloop-test", "arrowloop-secret"

	backend := s3mem.New()
	faker := gofakes3.New(backend, gofakes3.WithV4Auth(map[string]string{key: secret}))
	srv := httptest.NewServer(faker.Server())
	t.Cleanup(srv.Close)

	if err := backend.CreateBucket(t.Context(), bucket); err != nil {
		t.Fatalf("create bucket: %v", err)
	}

	return fmt.Sprintf(
		`:s3,provider=Other,access_key_id=%s,secret_access_key=%s,endpoint="%s",force_path_style=true:%s`,
		key, secret, srv.URL, bucket,
	)
}

// startSFTP runs an SSH server with an SFTP subsystem over a temporary
// directory, and returns the rclone remote string that reaches it.
func startSFTP(t *testing.T, root string) string {
	t.Helper()
	const user, password = "reeve", "roll"

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("host key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("host signer: %v", err)
	}

	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if c.User() == user && string(pass) == password {
				return nil, nil
			}
			return nil, fmt.Errorf("wrong credentials")
		},
	}
	cfg.AddHostKey(signer)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { listener.Close() })

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return // the listener was closed by the cleanup above
			}
			go serveSFTP(conn, cfg, root)
		}
	}()

	obscured, err := obscure.Obscure(password)
	if err != nil {
		t.Fatalf("obscure the password: %v", err)
	}
	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatalf("split the address: %v", err)
	}
	// shell_type=none stops rclone probing for a remote shell, which this
	// server does not offer: it serves the SFTP subsystem and nothing else.
	return fmt.Sprintf(
		`:sftp,host=127.0.0.1,port=%s,user=%s,pass=%s,shell_type=none:`,
		port, user, obscured,
	)
}

func serveSFTP(conn net.Conn, cfg *ssh.ServerConfig, root string) {
	defer conn.Close()
	sshConn, chans, reqs, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		return
	}
	defer sshConn.Close()
	go ssh.DiscardRequests(reqs)

	for newChannel := range chans {
		if newChannel.ChannelType() != "session" {
			newChannel.Reject(ssh.UnknownChannelType, "only sessions here")
			continue
		}
		channel, requests, err := newChannel.Accept()
		if err != nil {
			return
		}
		go func(in <-chan *ssh.Request) {
			for req := range in {
				req.Reply(req.Type == "subsystem" && len(req.Payload) >= 4 && string(req.Payload[4:]) == "sftp", nil)
			}
		}(requests)

		server, err := sftp.NewServer(channel, sftp.WithServerWorkingDirectory(root))
		if err != nil {
			channel.Close()
			continue
		}
		if err := server.Serve(); err != nil && err != io.EOF {
			// Nothing useful to do with it here; the test will fail on the
			// operation that could not complete, with a better message.
			_ = err
		}
		server.Close()
		channel.Close()
	}
}

// throughBackend runs the ordinary life of a job with the right side on a real
// remote, and demands the same properties the local tests demand.
func throughBackend(t *testing.T, remote string) {
	t.Helper()
	m := newRemoteJob(t, remote)

	for i := range 10 {
		write(t, m.local, fmt.Sprintf("dir%d/file%02d.txt", i%3, i), fmt.Sprintf("initial %d", i))
	}
	_, res := m.sync(t)
	if res.Copied != 10 {
		t.Fatalf("expected ten files across, got %d", res.Copied)
	}
	// Nothing may be postponed here, and the reason to say so at this point is
	// that the alternative reads as something else entirely. A file that copies
	// and then fails to be recorded turns up two assertions later as a file
	// that is not "unchanged", which sounds like a modification time that did
	// not survive the round trip and sent the last search in the wrong
	// direction for an afternoon.
	if len(res.Skipped) != 0 {
		t.Fatalf("the first run postponed %d things: %+v", len(res.Skipped), res.Skipped)
	}
	requireSame(t, m, "after the first run")

	// The one that finds a backend whose modification times do not survive a
	// round trip: every file would look changed forever.
	p, res := m.sync(t)
	if len(p.Actions) != 0 || res.Copied != 0 {
		t.Fatalf("the job did not settle: %d actions, %d copied again", len(p.Actions), res.Copied)
	}
	if p.Unchanged != 10 {
		// Agreed is the tell. A file both sides hold identically with no record
		// of it lands there rather than in Unchanged, which means the record
		// was lost rather than the modification time being wrong.
		t.Fatalf("only %d of 10 were recognised as unchanged, and %d were treated as newly identical, "+
			"which is what a lost record looks like", p.Unchanged, len(p.Agreed))
	}

	// An edit travels.
	write(t, m.local, "dir0/file00.txt", "edited locally")
	if _, res := m.sync(t); res.Copied != 1 {
		t.Fatalf("an edit did not travel: %d copied", res.Copied)
	}
	requireSame(t, m, "after an edit")

	// A rename becomes a move rather than a fresh upload, which is the
	// difference between a second and an afternoon on a real link.
	if err := os.Rename(
		filepath.Join(m.local, "dir1", "file01.txt"),
		filepath.Join(m.local, "dir1", "renamed.txt"),
	); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, res := m.sync(t); res.Moved != 1 || res.Copied != 0 {
		t.Fatalf("a rename was not folded into a move: %d moved, %d copied", res.Moved, res.Copied)
	}
	requireSame(t, m, "after a rename")

	// A deletion propagates and the removed file lands in the remote's trash
	// rather than simply going.
	if err := os.Remove(filepath.Join(m.local, "dir2", "file02.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, res := m.sync(t); res.Trashed != 1 {
		t.Fatalf("a deletion did not propagate: %d trashed", res.Trashed)
	}
	requireSame(t, m, "after a deletion")

	var trashed bool
	for name := range everything(t, m.ends.Right) {
		if scan.IsReserved(name) {
			trashed = true
		}
	}
	if !trashed {
		t.Error("the deleted file is not in the remote's trash; it is simply gone")
	}
}

// TestThroughRealS3 runs a job against a genuine S3 API.
func TestThroughRealS3(t *testing.T) {
	throughBackend(t, startS3(t, "arrowloop"))
}

// TestThroughRealSFTP runs a job against a genuine SFTP server over SSH.
func TestThroughRealSFTP(t *testing.T) {
	throughBackend(t, startSFTP(t, t.TempDir()))
}

// TestS3RefusesEmptyFolders states the capability rather than the wish. A
// bucket has no directories, so a folder created there disappears the moment
// nothing uses the prefix, and a job that kept trying would report making the
// same folder on every run.
func TestS3RefusesEmptyFolders(t *testing.T) {
	m := newRemoteJob(t, startS3(t, "emptydirs"))
	m.opt.EmptyDirs = true

	if err := os.MkdirAll(filepath.Join(m.local, "waiting"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	write(t, m.local, "real.txt", "content")

	p, res := m.sync(t)
	if res.DirsMade != 0 || len(p.Dirs) != 0 {
		t.Fatalf("folders were carried to a bucket: %d made, %d planned", res.DirsMade, len(p.Dirs))
	}
	if res.Copied != 1 {
		t.Fatalf("the real file did not cross: %d copied", res.Copied)
	}
}

// TestSFTPCarriesEmptyFolders is the other half of that pair. SFTP does have
// real directories, so the same job that refuses on a bucket has to carry them
// here, and the difference has to come from what the backend reports rather
// than from anything hard-coded.
func TestSFTPCarriesEmptyFolders(t *testing.T) {
	m := newRemoteJob(t, startSFTP(t, t.TempDir()))
	m.opt.EmptyDirs = true

	if err := os.MkdirAll(filepath.Join(m.local, "waiting"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	write(t, m.local, "real.txt", "content")

	_, res := m.sync(t)
	if res.DirsMade != 1 {
		t.Fatalf("an empty folder did not reach an SFTP host that can hold one: %d made", res.DirsMade)
	}
}

// TestAConflictAcrossSFTP resolves a genuine disagreement over the wire, which
// takes three operations and has to leave both versions on both sides.
func TestAConflictAcrossSFTP(t *testing.T) {
	remoteRoot := t.TempDir()
	m := newRemoteJob(t, startSFTP(t, remoteRoot))

	write(t, m.local, "notes.txt", "the original")
	m.sync(t)

	write(t, m.local, "notes.txt", "the local version")
	time.Sleep(1100 * time.Millisecond) // SFTP stores whole seconds
	// Change the far side behind the engine's back, which is what a second
	// machine writing to the same host looks like from here.
	if err := os.WriteFile(filepath.Join(remoteRoot, "notes.txt"), []byte("the remote version"), 0o644); err != nil {
		t.Fatalf("write on the remote: %v", err)
	}

	_, res := m.sync(t)
	if res.Conflicts != 1 {
		t.Fatalf("expected one conflict, got %d", res.Conflicts)
	}
	requireSame(t, m, "after a conflict over SFTP")

	both := contents(t, m.ends.Left)
	var seenLocal, seenRemote bool
	for _, body := range both {
		switch body {
		case "the local version":
			seenLocal = true
		case "the remote version":
			seenRemote = true
		}
	}
	if !seenLocal || !seenRemote {
		t.Fatalf("a version was lost resolving a conflict over SFTP: %v", both)
	}

	if p, _ := m.sync(t); len(p.Actions) != 0 {
		t.Fatalf("the conflict did not settle: %d actions left", len(p.Actions))
	}
}

// newRemoteJob builds a job with a local left side and whatever remote is given
// on the right.
func newRemoteJob(t *testing.T, remote string) *mixed {
	t.Helper()
	m := newMixed(t, "unused")
	right, err := rclonefs.NewFs(t.Context(), remote)
	if err != nil {
		t.Fatalf("open %s: %v", remote, err)
	}
	m.ends.Right = right
	return m
}
