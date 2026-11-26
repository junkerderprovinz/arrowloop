package cli

import (
	"encoding/base64"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/junkerderprovinz/arrowloop/internal/appdata"
	"github.com/junkerderprovinz/arrowloop/internal/appdocs"
)

// The phone app hands the same secrets to the server and to the engine. They
// travel in the environment because a command line can be read by others.
const (
	envDataAddr    = "ARROWLOOP_DATA_ADDR"
	envRootAddr    = "ARROWLOOP_ROOT_ADDR"
	envDataPass    = "ARROWLOOP_DATA_PASS"
	envDataHostKey = "ARROWLOOP_DATA_HOSTKEY"
)

// cmdServeData serves a folder to the engine, Android/data unless told
// otherwise; see internal/appdata. The phone app starts it as root or as the
// adb shell user, and once more with -root / -read-only for the Root target.
func cmdServeData(args []string) error {
	fset := flag.NewFlagSet("serve-data", flag.ExitOnError)
	addr := fset.String("addr", "127.0.0.1:8423", "address to listen on")
	root := fset.String("root", "/storage/emulated/0/Android/data", "the folder to serve")
	readOnly := fset.Bool("read-only", false, "refuse every change")
	adopt := fset.Bool("adopt", false, "hand new files to the app whose folder they are in (root only)")
	exitOnEOF := fset.Bool("exit-on-eof", false, "stop when standard input closes, so the server ends with the app that started it")
	if err := fset.Parse(args); err != nil {
		return err
	}
	if *root == "/" {
		appdata.EnterInitNamespace(os.Args[1:])
	}
	seed, err := base64.StdEncoding.DecodeString(os.Getenv(envDataHostKey))
	if err != nil {
		return fmt.Errorf("%s: %w", envDataHostKey, err)
	}
	done := make(chan error, 2)
	go func() {
		done <- appdata.Serve(appdata.Options{
			Addr:     *addr,
			Root:     *root,
			Password: os.Getenv(envDataPass),
			HostKey:  seed,
			ReadOnly: *readOnly,
			Adopt:    *adopt,
		})
	}()
	// A server started through su or Shizuku outlives the app when the app is
	// killed, and nothing else would ever stop it. The app holds the other end
	// of the pipe, and the kernel closes it however the app goes.
	if *exitOnEOF {
		go func() {
			_, _ = io.Copy(io.Discard, os.Stdin)
			done <- nil
		}()
	}
	return <-done
}

// linkTargets offers Android/data and the whole file system as targets while
// the phone app runs their servers, and takes each away again when it no
// longer does.
func linkTargets(home string) {
	linkServed(appdata.AndroidData, os.Getenv(envDataAddr), filepath.Join(home, "android-data.known_hosts"))
	linkServed(appdata.Root, os.Getenv(envRootAddr), filepath.Join(home, "root.known_hosts"))
}

func linkServed(t appdata.Target, addr, knownHosts string) {
	if addr == "" {
		if err := t.Unlink(); err != nil {
			logf("%s: %v", t.Name, err)
		}
		return
	}
	seed, err := base64.StdEncoding.DecodeString(os.Getenv(envDataHostKey))
	if err == nil {
		err = t.Link(addr, os.Getenv(envDataPass), seed, knownHosts)
	}
	if err != nil {
		logf("%s: %v", t.Name, err)
	}
}

// envDocsSocket names the socket on which the phone app answers for the
// folders other apps share with it; see internal/appdocs.
const envDocsSocket = "ARROWLOOP_DOCS_SOCKET"

// linkAppDocs offers those folders as a target while the phone app has any,
// and takes it away again when it has none.
func linkAppDocs(home string) {
	socket := os.Getenv(envDocsSocket)
	var err error
	if socket == "" {
		err = appdocs.Shared.Unlink()
	} else {
		err = appdocs.Offer(socket, os.TempDir(), filepath.Join(home, "apps.known_hosts"))
	}
	if err != nil {
		logf("shared folders: %v", err)
	}
}
