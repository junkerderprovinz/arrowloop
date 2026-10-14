package appdocs

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"time"

	"github.com/pkg/sftp"
)

// handler answers SFTP requests by asking the app. A file comes over whole
// into a spool file before the first byte is read, and goes back whole when
// it is closed, because the app streams a document from start to end while
// an SFTP client may read and write at any offset.
type handler struct {
	app   *client
	spool string
}

func clean(p string) string { return path.Clean("/" + p) }

func missing(err error) bool { return errors.Is(err, sftp.ErrSSHFxNoSuchFile) }

func (h *handler) Fileread(r *sftp.Request) (io.ReaderAt, error) {
	f, err := h.fetch(clean(r.Filepath))
	if err != nil {
		return nil, err
	}
	return f, nil
}

// fetch copies the file at p into a new spool file.
func (h *handler) fetch(p string) (*spooled, error) {
	f, err := h.newSpool()
	if err != nil {
		return nil, err
	}
	if _, err := h.app.call(request{Op: "read", Path: p}, nil, f.File); err != nil {
		f.discard()
		return nil, err
	}
	return f, nil
}

func (h *handler) newSpool() (*spooled, error) {
	f, err := os.CreateTemp(h.spool, "doc-*")
	if err != nil {
		return nil, err
	}
	return &spooled{File: f}, nil
}

func (h *handler) Filewrite(r *sftp.Request) (io.WriterAt, error) {
	p := clean(r.Filepath)
	flags := r.Pflags()
	e, err := h.app.stat(p)
	switch {
	case err != nil && !missing(err):
		return nil, err
	case err != nil && !flags.Creat:
		return nil, err
	case err == nil && e.Dir:
		return nil, sftp.ErrSSHFxFailure
	case err == nil && flags.Excl:
		return nil, sftp.ErrSSHFxFailure
	}
	var f *spooled
	if err == nil && !flags.Trunc {
		f, err = h.fetch(p)
	} else {
		f, err = h.newSpool()
	}
	if err != nil {
		return nil, err
	}
	f.upload = func() error {
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return err
		}
		_, err := h.app.call(request{Op: "write", Path: p}, f.File, nil)
		return err
	}
	return f, nil
}

func (h *handler) Filecmd(r *sftp.Request) error {
	p := clean(r.Filepath)
	switch r.Method {
	case "Setstat":
		return h.setstat(p, r)
	case "Mkdir":
		return h.app.do("mkdir", p)
	case "Rmdir":
		return h.app.do("rmdir", p)
	case "Remove":
		return h.app.do("remove", p)
	case "Rename", "PosixRename":
		// Both replace a file already there, as rename(2) does: rclone puts a
		// changed file in place by renaming its upload over the old one.
		_, err := h.app.call(request{Op: "rename", Path: p, To: clean(r.Target), Replace: true}, nil, nil)
		return err
	}
	return sftp.ErrSSHFxOpUnsupported
}

// setstat keeps a modification time and accepts a size the file already has.
// Owner and permissions mean nothing to a document.
func (h *handler) setstat(p string, r *sftp.Request) error {
	flags := r.AttrFlags()
	attrs := r.Attributes()
	if flags.Size {
		e, err := h.app.stat(p)
		if err != nil {
			return err
		}
		if uint64(e.Size) != attrs.Size {
			return sftp.ErrSSHFxOpUnsupported
		}
	}
	if flags.Acmodtime {
		_, err := h.app.call(request{Op: "touch", Path: p, MTime: attrs.ModTime().UnixMilli()}, nil, nil)
		return err
	}
	return nil
}

func (h *handler) Filelist(r *sftp.Request) (sftp.ListerAt, error) {
	p := clean(r.Filepath)
	switch r.Method {
	case "List":
		a, err := h.app.call(request{Op: "list", Path: p}, nil, nil)
		if err != nil {
			return nil, err
		}
		infos := make(listing, len(a.Entries))
		for i, e := range a.Entries {
			infos[i] = info{e}
		}
		return infos, nil
	case "Stat", "Lstat":
		e, err := h.app.stat(p)
		if err != nil {
			return nil, err
		}
		return listing{info{e}}, nil
	}
	return nil, sftp.ErrSSHFxOpUnsupported
}

// spooled is a file's bytes on the engine's side. Closing it sends them to
// the app if it was opened for writing, and removes it either way.
type spooled struct {
	*os.File
	upload func() error
}

func (s *spooled) Close() error {
	var err error
	if s.upload != nil {
		err = s.upload()
	}
	s.discard()
	return err
}

func (s *spooled) discard() {
	s.File.Close()
	os.Remove(s.Name())
}

// info is an entry as a file system reports one.
type info struct{ e entry }

func (i info) Name() string       { return i.e.Name }
func (i info) Size() int64        { return i.e.Size }
func (i info) ModTime() time.Time { return time.UnixMilli(i.e.MTime) }
func (i info) IsDir() bool        { return i.e.Dir }
func (i info) Sys() any           { return nil }

func (i info) Mode() fs.FileMode {
	if i.e.Dir {
		return fs.ModeDir | 0o755
	}
	return 0o644
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
