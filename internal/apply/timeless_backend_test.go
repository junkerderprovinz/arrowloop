package apply

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/hash"
)

// MEGA keeps neither modification times nor checksums and reports the moment
// a file was uploaded as its time. A copy that arrives whole is recorded, or
// every run sends it again and calls it written to meanwhile.
func TestACopyToABackendWithoutTimesIsRecorded(t *testing.T) {
	j := newCopyJob(t)
	writeAt(t, filepath.Join(j.left, "backup.json"), "AAAA", j.stamp)
	j.ends.Right = uploadStamped{Fs: j.ends.Right, uploaded: time.Now()}

	res, err := j.run(context.Background(), j.copy("backup.json", 4))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if !j.recorded(t, "backup.json") {
		t.Fatal("no row for a copy that arrived whole, so the next run sends it again")
	}
	if len(res.Skipped) != 0 {
		t.Errorf("the copy was left for later: %+v", res.Skipped)
	}
}

// uploadStamped is a destination like MEGA: no checksums, no settable times,
// and the upload's own moment as every file's time.
type uploadStamped struct {
	rclonefs.Fs
	uploaded time.Time
}

func (uploadStamped) Precision() time.Duration { return rclonefs.ModTimeNotSupported }

func (uploadStamped) Hashes() hash.Set { return hash.Set(hash.None) }

// Features drops the server-side copy, which the local backend has on macOS
// and which would write the file without asking Put.
func (f uploadStamped) Features() *rclonefs.Features {
	ft := *f.Fs.Features()
	ft.Copy = nil
	ft.SlowHash = false
	return &ft
}

func (f uploadStamped) NewObject(ctx context.Context, remote string) (rclonefs.Object, error) {
	o, err := f.Fs.NewObject(ctx, remote)
	if err != nil {
		return nil, err
	}
	return uploadStampedObject{o, f}, nil
}

func (f uploadStamped) List(ctx context.Context, dir string) (rclonefs.DirEntries, error) {
	entries, err := f.Fs.List(ctx, dir)
	if err != nil {
		return nil, err
	}
	for i, e := range entries {
		if o, ok := e.(rclonefs.Object); ok {
			entries[i] = uploadStampedObject{o, f}
		}
	}
	return entries, nil
}

type uploadStampedObject struct {
	rclonefs.Object
	fs uploadStamped
}

func (o uploadStampedObject) Fs() rclonefs.Info { return o.fs }

func (o uploadStampedObject) ModTime(context.Context) time.Time { return o.fs.uploaded }

func (uploadStampedObject) SetModTime(context.Context, time.Time) error {
	return rclonefs.ErrorCantSetModTime
}

func (uploadStampedObject) Hash(context.Context, hash.Type) (string, error) {
	return "", hash.ErrUnsupported
}
