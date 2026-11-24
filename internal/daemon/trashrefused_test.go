package daemon

import (
	"context"
	"crypto/rand"
	"fmt"
	"net"
	"os"
	"path"
	"path/filepath"
	"testing"

	"github.com/pkg/sftp"
	"github.com/rclone/rclone/fs/config/obscure"

	"github.com/junkerderprovinz/arrowloop/internal/appdata"
	"github.com/junkerderprovinz/arrowloop/internal/failure"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/precheck"
)

// ownHomeOnly lets nothing be made at the top of the server but the home
// folder, like a server root for a login that is not root.
type ownHomeOnly struct{ sftp.FileCmder }

func (h ownHomeOnly) Filecmd(r *sftp.Request) error {
	for _, p := range []string{r.Filepath, r.Target} {
		if p != "" && path.Dir(path.Clean(p)) == "/" && path.Clean(p) != "/home" {
			return sftp.ErrSSHFxPermissionDenied
		}
	}
	return h.FileCmder.Filecmd(r)
}

// serverRoot serves a server whose root only holds the login's home and
// returns the side that reaches the root.
func serverRoot(t *testing.T) string {
	t.Helper()
	seed := make([]byte, 32)
	if _, err := rand.Read(seed); err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	handlers := sftp.InMemHandler()
	if err := handlers.FileCmd.Filecmd(sftp.NewRequest("Mkdir", "/home")); err != nil {
		t.Fatal(err)
	}
	handlers.FileCmd = ownHomeOnly{handlers.FileCmd}
	go func() { _ = appdata.ServeSFTP(ln, "letmein", seed, handlers) }()

	pass, err := obscure.Obscure("letmein")
	if err != nil {
		t.Fatal(err)
	}
	_, port, _ := net.SplitHostPort(ln.Addr().String())
	return fmt.Sprintf(":sftp,host=127.0.0.1,port=%s,user=%s,pass=%s,shell_type=none,md5sum_command=none,sha1sum_command=none:/", port, appdata.User, pass)
}

// rootJob is a runner with one two-way job between a local folder and the
// root of such a server, after a first run that put a few files in the home.
func rootJob(t *testing.T, noTrash bool) (*Runner, string, job.Job) {
	t.Helper()
	dir := t.TempDir()
	local := filepath.Join(dir, "local")
	if err := os.MkdirAll(filepath.Join(local, "home"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.txt", "b.txt", "c.txt", "d.txt", "e.txt"} {
		if err := os.WriteFile(filepath.Join(local, "home", name), []byte("hello"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	hist, err := history.Open(context.Background(), filepath.Join(dir, "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { hist.Close() })
	j := job.Job{Name: "root", Left: local, Right: serverRoot(t), State: filepath.Join(dir, "state.db"), QuietPeriod: "0s", NoTrash: noTrash}
	r := New(&job.Config{Jobs: []job.Job{j}, ParallelJobs: 1}, hist, t.Logf)
	if rec, err := r.Run(context.Background(), "root"); err != nil || rec.Copied != 5 {
		t.Fatalf("first run copied %d: %v", rec.Copied, err)
	}
	return r, local, j
}

func TestADeletionAtAServerRootTheLoginMayNotWriteInStopsTheRunAndSaysWhy(t *testing.T) {
	r, local, j := rootJob(t, false)
	if err := os.Remove(filepath.Join(local, "home", "a.txt")); err != nil {
		t.Fatal(err)
	}

	rec, err := r.Run(context.Background(), "root")

	if err == nil || !rec.Failed() {
		t.Fatalf("the run went through without a trash to keep the file in: %+v", rec)
	}
	if f := failure.Of(rec.Err); f == nil || f.Code != failure.TrashRefused || f.Params["side"] != "right" {
		t.Errorf("the run ended with %q, read as %+v", rec.Err, f)
	}
	if rec.Trashed != 0 || rec.Copied != 0 {
		t.Errorf("the stopped run still changed things: %+v", rec)
	}

	report := precheck.Check(context.Background(), j, precheck.Opts{NoEstimate: true})
	found := false
	for _, f := range report.Findings {
		found = found || f.Code == "trashRefused" && f.Side == "right" && f.Fatal
		if f.Code == "sideReadOnly" {
			t.Errorf("the check called the side read-only: %+v", f)
		}
	}
	if !found {
		t.Errorf("the check did not name the trash: %+v", report.Findings)
	}
}

func TestATrashlessJobDeletesAtAServerRootTheLoginMayNotWriteIn(t *testing.T) {
	r, local, _ := rootJob(t, true)
	if err := os.Remove(filepath.Join(local, "home", "a.txt")); err != nil {
		t.Fatal(err)
	}

	rec, err := r.Run(context.Background(), "root")

	if err != nil || rec.Trashed != 1 {
		t.Errorf("the deletion did not go through: trashed %d, %v", rec.Trashed, err)
	}
}
