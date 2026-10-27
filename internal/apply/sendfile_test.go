package apply

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// OpenCloud answers a new modification time with success and keeps the old
// one, so a file that differs only in its time has to be sent again.
func TestAFileIsSentWhenTheDestinationIgnoresANewTime(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	left := filepath.Join(root, "left")
	right := filepath.Join(root, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	older := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	newer := older.Add(15 * time.Minute)
	writeAt(t, filepath.Join(left, "app.extra"), "same", older)
	writeAt(t, filepath.Join(right, "app.extra"), "same", newer)

	src, err := rclonefs.NewFs(ctx, left)
	if err != nil {
		t.Fatalf("left fs: %v", err)
	}
	dst, err := rclonefs.NewFs(ctx, right)
	if err != nil {
		t.Fatalf("right fs: %v", err)
	}
	sent := &scan.Entry{Path: "app.extra", Size: 4, Mod: older}
	over := &scan.Entry{Path: "app.extra", Size: 4, Mod: newer}

	if err := sendFile(ctx, timeless{dst}, src, "app.extra", "app.extra", sent, over); err != nil {
		t.Fatalf("send: %v", err)
	}
	info, err := os.Stat(filepath.Join(right, "app.extra"))
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if !info.ModTime().Equal(older) {
		t.Errorf("the right side still says %s, so the next run finds the pair apart again", info.ModTime())
	}
}

// timeless wraps a real filesystem whose objects accept a new modification time
// and keep the old one.
type timeless struct{ rclonefs.Fs }

func (f timeless) NewObject(ctx context.Context, remote string) (rclonefs.Object, error) {
	o, err := f.Fs.NewObject(ctx, remote)
	if err != nil {
		return nil, err
	}
	return timelessObject{o}, nil
}

type timelessObject struct{ rclonefs.Object }

func (timelessObject) SetModTime(context.Context, time.Time) error { return nil }
