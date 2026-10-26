package remotes

import (
	"context"
	"errors"
	"fmt"
	"path"
	"runtime"
	"sort"
	"strings"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config"
)

// Split reports whether p names a place on a configured target, and if so
// which target and which folder inside it. A single letter before the colon
// is a Windows drive, as rclone itself reads it, whatever the targets are
// called.
func Split(p string) (name, dir string, ok bool) {
	name, dir, found := strings.Cut(p, ":")
	if !found || name == "" {
		return "", "", false
	}
	if runtime.GOOS == "windows" && len(name) == 1 {
		return "", "", false
	}
	if !config.LoadedData().HasSection(name) {
		return "", "", false
	}
	// A lone slash is SFTP's filesystem root, which differs from the empty
	// path, the login's home.
	if dir != "/" {
		dir = strings.TrimRight(dir, "/")
	}
	return name, dir, true
}

// Join is the remote string for a folder on a target.
func Join(name, dir string) string {
	return name + ":" + dir
}

// Parent is the folder above dir on the same target, or empty at the target's
// root, where the picker goes back to its list of roots.
func Parent(name, dir string) string {
	if dir == "" || dir == Root(name) {
		return ""
	}
	up := path.Dir(dir)
	switch up {
	case dir:
		return ""
	case ".":
		return Join(name, "")
	}
	return Join(name, up)
}

// Folders lists the folders directly inside dir on a target, sorted without
// regard to case. Files are left out, since a job's side is always a folder.
func Folders(ctx context.Context, name, dir string) ([]string, error) {
	ctx, stop := context.WithTimeout(ctx, CheckWait)
	defer stop()

	f, err := rclonefs.NewFs(ctx, Join(name, dir))
	if errors.Is(err, rclonefs.ErrorIsFile) {
		return nil, fmt.Errorf("%s is a file, not a folder", Join(name, dir))
	}
	if err != nil {
		return nil, checkErr(ctx, err)
	}
	entries, err := f.List(ctx, "")
	if err != nil {
		return nil, checkErr(ctx, err)
	}
	out := []string{}
	entries.ForDir(func(d rclonefs.Directory) {
		out = append(out, path.Base(d.Remote()))
	})
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i]) < strings.ToLower(out[j]) })
	return out, nil
}

// MakeFolder creates the folder child inside dir on a target and returns its
// remote string.
func MakeFolder(ctx context.Context, name, dir, child string) (string, error) {
	ctx, stop := context.WithTimeout(ctx, CheckWait)
	defer stop()

	f, err := rclonefs.NewFs(ctx, makeAt(name, dir))
	if err != nil {
		return "", checkErr(ctx, err)
	}
	if err := f.Mkdir(ctx, child); err != nil {
		return "", checkErr(ctx, err)
	}
	return Join(name, path.Join(dir, child)), nil
}

// makeAt is where MakeFolder opens a target to make a folder in dir. At the top
// of an AWS target that folder is a bucket, which AWS puts where
// location_constraint says rather than region; with that empty rclone asks for
// us-east-1, which a target signing for any other region is refused.
func makeAt(name, dir string) string {
	data := config.LoadedData()
	get := func(key string) string {
		value, _ := data.GetValue(name, key)
		return value
	}
	region := get("region")
	if dir != "" || get("type") != "s3" || get("provider") != "AWS" || region == "" || region == "us-east-1" || get("location_constraint") != "" {
		return Join(name, dir)
	}
	return name + ",location_constraint=" + quoteValue(region) + ":"
}

// Reaches reports whether a side lands on the target called name, itself or
// through a target that wraps it, such as an encrypted folder kept there.
func Reaches(side, name string) bool {
	// Eight wrappers deep is more than anybody stacks, and stops a target
	// that wraps itself.
	for range 8 {
		target, _, ok := Split(side)
		if !ok {
			return false
		}
		if target == name {
			return true
		}
		side, _ = config.LoadedData().GetValue(target, "remote")
	}
	return false
}
