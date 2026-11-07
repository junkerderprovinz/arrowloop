package remotes

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/ftp"

	"github.com/junkerderprovinz/arrowloop/internal/ftptest"
)

// phoneTarget saves a target for an FTP server that takes one login at a time,
// so any login a look at it leaves open costs the next look its own.
func phoneTarget(t *testing.T) (string, *ftptest.Server) {
	t.Helper()
	ownConfig(t)
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "DCIM"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	server := ftptest.Start(t, root, 1)
	const name = "arrowloop-test-phone"
	if err := Save(name, "ftp", server.Settings()); err != nil {
		t.Fatalf("save: %v", err)
	}
	t.Cleanup(func() { _ = Delete(name) })
	return name, server
}

func loggedOut(t *testing.T, server *ftptest.Server, what string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for server.LoggedIn() > 0 {
		if time.Now().After(deadline) {
			t.Fatalf("%s left its login to the FTP server open", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestLookingAtAnFTPTargetLogsOutAfterwards(t *testing.T) {
	name, server := phoneTarget(t)
	ctx := context.Background()

	if err := Check(ctx, name); err != nil {
		t.Fatalf("check: %v", err)
	}
	loggedOut(t, server, "the check")

	if _, err := Folders(ctx, name, ""); err != nil {
		t.Fatalf("folders: %v", err)
	}
	loggedOut(t, server, "listing the folders")

	if _, err := About(ctx, name); err != nil {
		t.Fatalf("about: %v", err)
	}
	loggedOut(t, server, "asking for the free space")

	if _, err := checkSettings(ctx, "ftp", server.Settings()); err != nil {
		t.Fatalf("test before saving: %v", err)
	}
	loggedOut(t, server, "the test before saving")
}
