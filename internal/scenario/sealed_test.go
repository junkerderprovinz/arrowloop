package scenario

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/rclone/rclone/backend/onedrive/api"
	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/engine"
)

// vaulted answers a listing of one folder the way OneDrive answers for its
// Personal Vault.
type vaulted struct {
	rclonefs.Fs
	dir string
}

func (v vaulted) List(ctx context.Context, dir string) (rclonefs.DirEntries, error) {
	if dir == v.dir {
		e := &api.Error{}
		e.ErrorInfo.Code = "invalidRequest"
		e.ErrorInfo.InnerError.Code = "invalidResourceId"
		e.ErrorInfo.Message = "ObjectHandle is Invalid"
		return nil, fmt.Errorf("couldn't list files: %w", e)
	}
	return v.Fs.List(ctx, dir)
}

func TestASealedFolderIsPassedOverAndNamed(t *testing.T) {
	opt := quick()
	opt.EmptyDirs = true
	j := newJob(t, opt)
	write(t, j.left, "Ausgaben.xlsx", "a")
	write(t, j.left, "Personal Vault/passport.pdf", "p")
	j.ends.Left = vaulted{Fs: j.ends.Left, dir: "Personal Vault"}

	p, res := j.sync(t)
	got := tree(t, j.right)
	if len(got) != 1 || got["Ausgaben.xlsx"] == "" {
		t.Fatalf("right side holds %v, want only Ausgaben.xlsx", keys(got))
	}
	if _, err := os.Stat(filepath.Join(j.right, "Personal Vault")); err == nil {
		t.Fatal("the sealed folder was created on the right side")
	}
	if len(p.PassedOver) != 1 || p.PassedOver[0].Path != "Personal Vault" || p.PassedOver[0].Reason.Code != "sealed" {
		t.Fatalf("passed over %v, want the sealed folder", p.PassedOver)
	}
	// No later run gets into the vault, so it is not work left for later.
	if len(res.Skipped) != 0 {
		t.Fatalf("the run left %v for later", res.Skipped)
	}
}

// A file under the same name on the other side cannot be compared with
// anything, so it is not copied into a folder nobody can see into.
func TestNothingIsCopiedIntoASealedFolder(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "Ausgaben.xlsx", "a")
	write(t, j.left, "Personal Vault/passport.pdf", "p")
	write(t, j.right, "Personal Vault/copy.pdf", "c")
	j.ends.Left = vaulted{Fs: j.ends.Left, dir: "Personal Vault"}

	j.sync(t)
	if got := tree(t, j.left); got["Personal Vault/copy.pdf"] != "" {
		t.Fatal("a file was copied into the sealed folder")
	}
}

// A folder that held recorded files and stops opening is not a vault; the run
// stops rather than pass over files it knew.
func TestAFolderThatSealsOverRecordedFilesStopsTheRun(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "Ausgaben.xlsx", "a")
	write(t, j.left, "Projects/plan.txt", "p")
	j.sync(t)

	j.ends.Left = vaulted{Fs: j.ends.Left, dir: "Projects"}
	if _, _, err := engine.Prepare(context.Background(), j.ends, j.db, j.opt); err == nil {
		t.Fatal("the run went ahead without the recorded files")
	}
}
