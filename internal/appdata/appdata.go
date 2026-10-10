// Package appdata serves Android's per-app folders (Android/data) to the
// engine over SFTP on loopback.
//
// Android hides those folders from every app but their owner, so the engine
// cannot open them itself. A second copy of the binary runs with more rights,
// as root or as the adb shell user, and the engine reaches it through an
// ordinary sftp remote.
package appdata

import (
	"crypto/ed25519"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"log"
	"net"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// User is the login name the engine presents. The password is what keeps
// other apps on the phone out, since every app can reach loopback.
const User = "arrowloop"

// Options configures a server.
type Options struct {
	// Addr is where to listen. It should be a loopback address.
	Addr string
	// Root is the folder served as "/", normally Android/data.
	Root string
	// Password is the one the engine has to give.
	Password string
	// HostKey is the ed25519 seed the server proves itself with, so the
	// engine can tell it from another app listening on the same port.
	HostKey []byte
	// ReadOnly refuses every change. The adb shell user has to run this way,
	// because what it writes into an app's folder belongs to the shell and
	// the app can no longer open it.
	ReadOnly bool
	// Adopt hands everything the server creates to the app whose folder it
	// is in. Only root can do that.
	Adopt bool
}

// Serve listens on o.Addr and answers SFTP sessions until the listener fails.
func Serve(o Options) error {
	ln, err := net.Listen("tcp", o.Addr)
	if err != nil {
		return err
	}
	defer ln.Close()
	return serve(ln, o)
}

func serve(ln net.Listener, o Options) error {
	if len(o.HostKey) != ed25519.SeedSize {
		return fmt.Errorf("the host key must be a %d byte seed", ed25519.SeedSize)
	}
	if o.Password == "" {
		return errors.New("a password is required")
	}
	h, err := newHandler(o.Root, o.ReadOnly, o.Adopt)
	if err != nil {
		return err
	}
	signer, err := ssh.NewSignerFromKey(ed25519.NewKeyFromSeed(o.HostKey))
	if err != nil {
		return err
	}
	config := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, given []byte) (*ssh.Permissions, error) {
			if c.User() == User && subtle.ConstantTimeCompare(given, []byte(o.Password)) == 1 {
				return nil, nil
			}
			return nil, errors.New("wrong password")
		},
	}
	config.AddHostKey(signer)

	log.Printf("serving %s on %s (read only: %t, adopting: %t)", h.root, ln.Addr(), o.ReadOnly, o.Adopt)
	for {
		conn, err := ln.Accept()
		if err != nil {
			return err
		}
		go serveConn(conn, config, h)
	}
}

// PublicKey is the host key a server started with seed presents.
func PublicKey(seed []byte) (ssh.PublicKey, error) {
	if len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("the host key must be a %d byte seed", ed25519.SeedSize)
	}
	return ssh.NewPublicKey(ed25519.NewKeyFromSeed(seed).Public())
}

func serveConn(conn net.Conn, config *ssh.ServerConfig, h *handler) {
	defer conn.Close()
	_, chans, reqs, err := ssh.NewServerConn(conn, config)
	if err != nil {
		return
	}
	go ssh.DiscardRequests(reqs)
	for nc := range chans {
		if nc.ChannelType() != "session" {
			_ = nc.Reject(ssh.UnknownChannelType, "only sessions")
			continue
		}
		ch, requests, err := nc.Accept()
		if err != nil {
			continue
		}
		go serveSession(ch, requests, h)
	}
}

// serveSession answers the sftp subsystem and nothing else. rclone asks for a
// shell to work out hash commands; refusing it makes rclone go without.
func serveSession(ch ssh.Channel, requests <-chan *ssh.Request, h *handler) {
	defer ch.Close()
	for req := range requests {
		if req.Type != "subsystem" || !isSFTP(req.Payload) {
			_ = req.Reply(false, nil)
			continue
		}
		_ = req.Reply(true, nil)
		server := sftp.NewRequestServer(ch, sftp.Handlers{FileGet: h, FilePut: h, FileCmd: h, FileList: h})
		if err := server.Serve(); err != nil && !errors.Is(err, io.EOF) {
			log.Printf("sftp session: %v", err)
		}
		_ = server.Close()
		return
	}
}

// isSFTP reads the subsystem name, an SSH string: four bytes of length, then
// the name.
func isSFTP(payload []byte) bool {
	return len(payload) > 4 && string(payload[4:]) == "sftp"
}
