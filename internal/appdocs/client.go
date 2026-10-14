package appdocs

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"

	"github.com/pkg/sftp"
)

// The phone app answers one request per connection: a line of JSON, then for
// a write the file's bytes. Its answer is a line of JSON, then for a read the
// file's bytes. Bytes travel in chunks, each led by its length as four bytes
// big-endian, and an empty chunk ends them, so a connection that breaks off
// cannot pass for a short file. See Docs.kt.

type request struct {
	Op      string `json:"op"`
	Path    string `json:"path"`
	To      string `json:"to,omitempty"`
	Replace bool   `json:"replace,omitempty"`
	MTime   int64  `json:"mtime,omitempty"`
}

// entry is a file or folder as the app reports it; MTime is in milliseconds.
type entry struct {
	Name  string `json:"name"`
	Dir   bool   `json:"dir"`
	Size  int64  `json:"size"`
	MTime int64  `json:"mtime"`
}

type answer struct {
	// Code is "missing" for something that is not there, "denied" for a
	// change the folder does not allow, and empty with no error.
	Code    string  `json:"code,omitempty"`
	Error   string  `json:"error,omitempty"`
	Entry   *entry  `json:"entry,omitempty"`
	Entries []entry `json:"entries,omitempty"`
}

const chunkSize = 64 << 10

type client struct {
	dial func() (net.Conn, error)
}

// call sends req with body, if any, and copies the bytes of the answer to
// out, if it is not nil.
func (c *client) call(req request, body io.Reader, out io.Writer) (answer, error) {
	conn, err := c.dial()
	if err != nil {
		return answer{}, fmt.Errorf("the app does not answer: %w", err)
	}
	defer conn.Close()
	line, err := json.Marshal(req)
	if err != nil {
		return answer{}, err
	}
	w := bufio.NewWriter(conn)
	if _, err := w.Write(append(line, '\n')); err != nil {
		return answer{}, err
	}
	if body != nil {
		if err := writeChunks(w, body); err != nil {
			return answer{}, err
		}
	}
	if err := w.Flush(); err != nil {
		return answer{}, err
	}
	r := bufio.NewReader(conn)
	reply, err := r.ReadBytes('\n')
	if err != nil {
		return answer{}, fmt.Errorf("the app broke off: %w", err)
	}
	var a answer
	if err := json.Unmarshal(reply, &a); err != nil {
		return answer{}, err
	}
	switch {
	case a.Code == "missing":
		return a, sftp.ErrSSHFxNoSuchFile
	case a.Code == "denied":
		return a, sftp.ErrSSHFxPermissionDenied
	case a.Error != "":
		return a, errors.New(a.Error)
	}
	if out != nil {
		return a, readChunks(r, out)
	}
	return a, nil
}

func writeChunks(w io.Writer, from io.Reader) error {
	buf := make([]byte, 4+chunkSize)
	for {
		n, err := io.ReadFull(from, buf[4:])
		if n > 0 {
			binary.BigEndian.PutUint32(buf, uint32(n))
			if _, err := w.Write(buf[:4+n]); err != nil {
				return err
			}
		}
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			_, err = w.Write([]byte{0, 0, 0, 0})
			return err
		}
		if err != nil {
			return err
		}
	}
}

func readChunks(r io.Reader, to io.Writer) error {
	var head [4]byte
	for {
		if _, err := io.ReadFull(r, head[:]); err != nil {
			return fmt.Errorf("the app broke off: %w", err)
		}
		n := binary.BigEndian.Uint32(head[:])
		if n == 0 {
			return nil
		}
		if n > chunkSize {
			return fmt.Errorf("the app sent a chunk of %d bytes", n)
		}
		if _, err := io.CopyN(to, r, int64(n)); err != nil {
			return fmt.Errorf("the app broke off: %w", err)
		}
	}
}

func (c *client) stat(p string) (entry, error) {
	a, err := c.call(request{Op: "stat", Path: p}, nil, nil)
	if err != nil {
		return entry{}, err
	}
	if a.Entry == nil {
		return entry{}, errors.New("the app answered without the entry")
	}
	return *a.Entry, nil
}

func (c *client) do(op, p string) error {
	_, err := c.call(request{Op: op, Path: p}, nil, nil)
	return err
}
