package appdata

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/pkg/sftp"
)

// handler maps SFTP requests onto the folder below root. The process may run
// as root, so nothing it touches may lead out of that folder: every directory
// on the way is resolved, and the last part of a path is never followed as a
// link. Otherwise an app could leave a link in its own folder and read
// another app's private data through us.
type handler struct {
	root     string
	readOnly bool
	adopt    bool
}

func newHandler(root string, readOnly, adopt bool) (*handler, error) {
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(real)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New(root + " is not a folder")
	}
	return &handler{root: real, readOnly: readOnly, adopt: adopt}, nil
}

var errDenied = sftp.ErrSSHFxPermissionDenied

// resolve turns a request path into a path on disk below the root, with its
// parent directories resolved.
func (h *handler) resolve(p string) (string, error) {
	rel := path.Clean("/" + p)
	if rel == "/" {
		return h.root, nil
	}
	parent, err := filepath.EvalSymlinks(filepath.Join(h.root, filepath.FromSlash(path.Dir(rel))))
	if err != nil {
		return "", err
	}
	if !h.inside(parent) {
		return "", errDenied
	}
	return filepath.Join(parent, path.Base(rel)), nil
}

func (h *handler) inside(p string) bool {
	return p == h.root || strings.HasPrefix(p, h.root+string(filepath.Separator))
}

// appFolder is the folder of the app that p belongs to, the first level below
// the root. It is empty for the root itself and for the app folders, which
// only Android creates.
func (h *handler) appFolder(p string) string {
	rel, err := filepath.Rel(h.root, p)
	if err != nil || rel == "." {
		return ""
	}
	first, rest, _ := strings.Cut(filepath.ToSlash(rel), "/")
	if rest == "" {
		return ""
	}
	return filepath.Join(h.root, first)
}

// writable says whether p may be changed, and if so which app folder its
// owner comes from.
func (h *handler) writable(p string) (string, error) {
	if h.readOnly {
		return "", errDenied
	}
	app := h.appFolder(p)
	if app == "" {
		return "", errDenied
	}
	return app, nil
}

func (h *handler) Fileread(r *sftp.Request) (io.ReaderAt, error) {
	p, err := h.resolve(r.Filepath)
	if err != nil {
		return nil, err
	}
	return os.OpenFile(p, os.O_RDONLY|noFollow, 0)
}

func (h *handler) Filewrite(r *sftp.Request) (io.WriterAt, error) {
	return h.open(r, os.O_WRONLY)
}

// OpenFile answers an open for reading and writing at once.
func (h *handler) OpenFile(r *sftp.Request) (sftp.WriterAtReaderAt, error) {
	return h.open(r, os.O_RDWR)
}

func (h *handler) open(r *sftp.Request, mode int) (*os.File, error) {
	p, err := h.resolve(r.Filepath)
	if err != nil {
		return nil, err
	}
	app, err := h.writable(p)
	if err != nil {
		return nil, err
	}
	flags := r.Pflags()
	mode |= noFollow
	if flags.Creat {
		mode |= os.O_CREATE
	}
	if flags.Trunc {
		mode |= os.O_TRUNC
	}
	if flags.Excl {
		mode |= os.O_EXCL
	}
	if flags.Append {
		mode |= os.O_APPEND
	}
	_, statErr := os.Lstat(p)
	created := errors.Is(statErr, fs.ErrNotExist)
	f, err := os.OpenFile(p, mode, 0o660)
	if err != nil {
		return nil, err
	}
	if created {
		if err := h.handOver(p, app, false); err != nil {
			f.Close()
			return nil, err
		}
	}
	return f, nil
}

func (h *handler) Filecmd(r *sftp.Request) error {
	p, err := h.resolve(r.Filepath)
	if err != nil {
		return err
	}
	app, err := h.writable(p)
	if err != nil {
		return err
	}
	switch r.Method {
	case "Setstat":
		return h.setstat(p, r)
	case "Mkdir":
		if err := os.Mkdir(p, 0o770); err != nil {
			return err
		}
		return h.handOver(p, app, true)
	case "Rmdir":
		return os.Remove(p)
	case "Remove":
		info, err := os.Lstat(p)
		if err != nil {
			return err
		}
		if info.IsDir() {
			return errDenied
		}
		return os.Remove(p)
	case "Rename", "PosixRename":
		to, err := h.resolve(r.Target)
		if err != nil {
			return err
		}
		toApp, err := h.writable(to)
		if err != nil {
			return err
		}
		// Ownership follows the app folder, so a move between two apps would
		// leave the file with the wrong one. rclone copies instead.
		if toApp != app {
			return errDenied
		}
		return os.Rename(p, to)
	}
	return sftp.ErrSSHFxOpUnsupported
}

func (h *handler) setstat(p string, r *sftp.Request) error {
	info, err := os.Lstat(p)
	if err != nil {
		return err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return errDenied
	}
	flags := r.AttrFlags()
	attrs := r.Attributes()
	if flags.Size {
		if err := os.Truncate(p, int64(attrs.Size)); err != nil {
			return err
		}
	}
	if flags.Acmodtime {
		if err := os.Chtimes(p, attrs.AccessTime(), attrs.ModTime()); err != nil {
			return err
		}
	}
	// Owner and permissions stay as handOver set them.
	return nil
}

func (h *handler) Filelist(r *sftp.Request) (sftp.ListerAt, error) {
	p, err := h.resolve(r.Filepath)
	if err != nil {
		return nil, err
	}
	switch r.Method {
	case "List":
		entries, err := os.ReadDir(p)
		if err != nil {
			return nil, err
		}
		infos := make([]fs.FileInfo, 0, len(entries))
		for _, e := range entries {
			info, err := e.Info()
			if err != nil {
				continue
			}
			infos = append(infos, info)
		}
		return listing(infos), nil
	case "Stat", "Lstat":
		info, err := os.Lstat(p)
		if err != nil {
			return nil, err
		}
		return listing{info}, nil
	}
	return nil, sftp.ErrSSHFxOpUnsupported
}

// listing pages a directory out to the client.
type listing []fs.FileInfo

func (l listing) ListAt(out []fs.FileInfo, offset int64) (int, error) {
	if offset >= int64(len(l)) {
		return 0, io.EOF
	}
	n := copy(out, l[offset:])
	if n < len(out) {
		return n, io.EOF
	}
	return n, nil
}
