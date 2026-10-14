// Package appdocs offers the folders other apps share through Android's file
// picker as a target.
//
// Only the phone app can open those folders, through the Storage Access
// Framework, so it answers for them on a socket that takes connections from
// its own processes alone. The engine puts an SFTP server on loopback in
// front of that socket and reaches it through an ordinary sftp remote, as it
// does for Android/data.
package appdocs

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"net"

	"github.com/pkg/sftp"

	"github.com/junkerderprovinz/arrowloop/internal/appdata"
)

// Shared is the target the folders show up as, one folder each.
var Shared = appdata.Target{Name: "Apps", Marker: "Folders other apps share with ArrowLoop on this phone"}

// Offer serves the folders the app answers for on socket and points the
// target at them. Files pass through spool on their way.
func Offer(socket, spool, knownHosts string) error {
	app := &client{dial: func() (net.Conn, error) { return net.Dial("unix", socket) }}
	return offer(app, spool, knownHosts)
}

func offer(app *client, spool, knownHosts string) error {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	// Drawn for each start, since the server ends with the engine.
	secret := make([]byte, 16)
	seed := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return err
	}
	if _, err := rand.Read(seed); err != nil {
		return err
	}
	password := hex.EncodeToString(secret)
	h := &handler{app: app, spool: spool}
	go func() {
		err := appdata.ServeSFTP(ln, password, seed, sftp.Handlers{FileGet: h, FilePut: h, FileCmd: h, FileList: h})
		log.Printf("shared folders: %v", err)
	}()
	return Shared.Link(ln.Addr().String(), password, seed, knownHosts)
}
