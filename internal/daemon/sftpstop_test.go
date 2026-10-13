package daemon

import (
	"context"
	"crypto/ed25519"
	"crypto/md5"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
	_ "github.com/rclone/rclone/backend/sftp"
	"github.com/rclone/rclone/fs/config/obscure"
	"golang.org/x/crypto/ssh"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// slowHost is an SSH server over a folder, as slow as a NAS at the end of a
// home connection: it carries perSecond bytes a second, and its md5sum takes
// hashTime for any file, the way a NAS takes minutes to read a film.
type slowHost struct {
	root      string
	perSecond int
	hashTime  time.Duration

	// hashing hears of every md5sum the moment it starts.
	hashing chan string
}

// start serves the host and returns the rclone remote that reaches it. A host
// with a hashTime offers a shell with md5sum, the way a NAS does.
func (h *slowHost) start(t *testing.T) string {
	t.Helper()
	const user, password = "tester", "secret"

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
				return
			}
			go h.serve(conn, cfg)
		}
	}()

	obscured, err := obscure.Obscure(password)
	if err != nil {
		t.Fatalf("obscure: %v", err)
	}
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	shell := "shell_type=none"
	if h.hashTime > 0 {
		shell = "shell_type=unix,md5sum_command=md5sum,sha1sum_command=none"
	}
	return fmt.Sprintf(`:sftp,host=127.0.0.1,port=%s,user=%s,pass=%s,%s:`, port, user, obscured, shell)
}

func (h *slowHost) serve(conn net.Conn, cfg *ssh.ServerConfig) {
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
		go h.session(channel, requests)
	}
}

// session answers the one request a session makes: the SFTP subsystem, or a
// command.
func (h *slowHost) session(channel ssh.Channel, requests <-chan *ssh.Request) {
	defer channel.Close()
	for req := range requests {
		switch {
		case req.Type == "subsystem" && string(req.Payload[4:]) == "sftp":
			req.Reply(true, nil)
			go ssh.DiscardRequests(requests)
			server, err := sftp.NewServer(throttled{channel, h.perSecond}, sftp.WithServerWorkingDirectory(h.root))
			if err != nil {
				return
			}
			_ = server.Serve()
			server.Close()
			return
		case req.Type == "exec" && h.hashTime > 0:
			req.Reply(true, nil)
			go ssh.DiscardRequests(requests)
			status := h.run(channel, string(req.Payload[4:]))
			_, _ = channel.SendRequest("exit-status", false, binary.BigEndian.AppendUint32(nil, status))
			return
		default:
			req.Reply(false, nil)
		}
	}
}

// run answers md5sum and nothing else. The file is found by its name alone,
// since the path rclone sends is the host's own spelling of it.
func (h *slowHost) run(out io.Writer, command string) uint32 {
	file, ok := strings.CutPrefix(command, "md5sum ")
	if !ok {
		return 127
	}
	file = strings.Trim(file, `'"`)
	body, err := os.ReadFile(filepath.Join(h.root, path.Base(strings.ReplaceAll(file, `\`, "/"))))
	if err != nil {
		return 1
	}
	if h.hashing != nil {
		h.hashing <- file
	}
	time.Sleep(h.hashTime)
	sum := md5.Sum(body)
	fmt.Fprintf(out, "%s  %s\n", hex.EncodeToString(sum[:]), file)
	return 0
}

// throttled carries an SSH channel no faster than perSecond bytes a second in
// either direction.
type throttled struct {
	ssh.Channel
	perSecond int
}

func (c throttled) Read(p []byte) (int, error) {
	p = p[:min(len(p), c.perSecond/20)]
	n, err := c.Channel.Read(p)
	c.wait(n)
	return n, err
}

func (c throttled) Write(p []byte) (int, error) {
	var sent int
	for len(p) > 0 {
		chunk := p[:min(len(p), c.perSecond/20)]
		n, err := c.Channel.Write(chunk)
		sent += n
		if err != nil {
			return sent, err
		}
		c.wait(n)
		p = p[n:]
	}
	return sent, nil
}

func (c throttled) wait(n int) {
	time.Sleep(time.Duration(n) * time.Second / time.Duration(c.perSecond))
}

// filmJob is a runner with one job between a local folder and a slow host,
// and one file of size bytes on the side the film starts from.
type filmJob struct {
	r      *Runner
	hist   *history.DB
	state  string
	local  string
	remote string
	size   int
	upload bool
}

func newFilmJob(t *testing.T, host *slowHost, size int, upload bool) *filmJob {
	t.Helper()
	root := t.TempDir()
	f := &filmJob{
		local:  filepath.Join(root, "local"),
		remote: filepath.Join(root, "remote"),
		state:  filepath.Join(root, "state.db"),
		size:   size,
		upload: upload,
	}
	for _, d := range []string{f.local, f.remote} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	from := f.remote
	if upload {
		from = f.local
	}
	body := make([]byte, size)
	_, _ = rand.Read(body)
	if err := os.WriteFile(filepath.Join(from, "film.mkv"), body, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	hist, err := history.Open(context.Background(), filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	f.hist = hist

	host.root = f.remote
	cfg := &job.Config{
		Jobs: []job.Job{{
			Name: "film", Left: f.local, Right: host.start(t),
			State: f.state, QuietPeriod: "0s",
		}},
		ParallelJobs: 1,
	}
	f.r = New(cfg, hist, t.Logf)
	return f
}

// stop stops the run and fails the test unless it ends within seconds, far
// sooner than the host finishes a checksum.
func (f *filmJob) stop(t *testing.T, done <-chan error) {
	t.Helper()
	asked := time.Now()
	if !f.r.Cancel("film") {
		t.Fatal("the run was not stoppable")
	}
	select {
	case err := <-done:
		if err == nil {
			t.Error("a stopped run reported success")
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("the run was still going %v after the stop", time.Since(asked))
	}
}

// stopped checks what a stopped run left: a record that says it was stopped,
// and no state row that calls the film synced.
func (f *filmJob) stopped(t *testing.T) {
	t.Helper()
	runs, err := f.hist.Recent(context.Background(), "film", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("read the log: %v", err)
	}
	if len(runs) != 1 || runs[0].Err == "" {
		t.Errorf("the log holds %+v, want one stopped run", runs)
	}

	db, err := state.Open(context.Background(), f.state)
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	defer db.Close()
	all, err := db.All(context.Background())
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	if len(all) != 0 {
		t.Errorf("the stopped film is recorded as synced: %+v", all)
	}
}

func (f *filmJob) run() <-chan error {
	done := make(chan error, 1)
	go func() {
		_, err := f.r.Run(context.Background(), "film")
		done <- err
	}()
	return done
}

// A film takes minutes to cross a home connection, and a stop has to end the
// transfer in flight rather than wait for it, whichever way the film goes.
func TestAStopEndsAFilmInFlight(t *testing.T) {
	for _, upload := range []bool{true, false} {
		name := "download"
		if upload {
			name = "upload"
		}
		t.Run(name, func(t *testing.T) {
			f := newFilmJob(t, &slowHost{perSecond: 4 << 20}, 64<<20, upload)
			events, unsubscribe := f.r.Subscribe()
			defer unsubscribe()
			done := f.run()

			deadline := time.After(20 * time.Second)
		moving:
			for {
				select {
				case ev := <-events:
					if ev.Phase == "moving" && ev.Speed > 0 {
						break moving
					}
				case err := <-done:
					t.Fatalf("the run ended before the film began to move: %v", err)
				case <-deadline:
					t.Fatal("the film never began to move")
				}
			}
			f.stop(t, done)
			f.stopped(t)
		})
	}
}

// Once a film is across, the NAS reads all of it again for its checksum,
// which takes minutes and runs as a command rclone cannot interrupt. A stop
// in that time has to end the run all the same.
func TestAStopDoesNotWaitForTheHostsChecksum(t *testing.T) {
	for _, upload := range []bool{true, false} {
		name := "download"
		if upload {
			name = "upload"
		}
		t.Run(name, func(t *testing.T) {
			host := &slowHost{perSecond: 64 << 20, hashTime: time.Minute, hashing: make(chan string, 8)}
			f := newFilmJob(t, host, 1<<20, upload)
			done := f.run()

			select {
			case <-host.hashing:
			case err := <-done:
				t.Fatalf("the run ended before the host was asked for a checksum: %v", err)
			case <-time.After(20 * time.Second):
				t.Fatal("the host was never asked for a checksum")
			}
			f.stop(t, done)
			f.stopped(t)
		})
	}
}
