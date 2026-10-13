package main

import (
	"encoding/base64"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/junkerderprovinz/arrowloop/internal/appdata"
)

// The phone app hands the same secrets to the server and to the engine. They
// travel in the environment because a command line can be read by others.
const (
	envDataAddr    = "ARROWLOOP_DATA_ADDR"
	envDataPass    = "ARROWLOOP_DATA_PASS"
	envDataHostKey = "ARROWLOOP_DATA_HOSTKEY"
)

// cmdServeData serves Android/data to the engine; see internal/appdata. The
// phone app starts it as root or as the adb shell user.
func cmdServeData(args []string) error {
	fset := flag.NewFlagSet("serve-data", flag.ExitOnError)
	addr := fset.String("addr", "127.0.0.1:8423", "address to listen on")
	root := fset.String("root", "/storage/emulated/0/Android/data", "the folder to serve")
	readOnly := fset.Bool("read-only", false, "refuse every change")
	adopt := fset.Bool("adopt", false, "hand new files to the app whose folder they are in (root only)")
	if err := fset.Parse(args); err != nil {
		return err
	}
	seed, err := base64.StdEncoding.DecodeString(os.Getenv(envDataHostKey))
	if err != nil {
		return fmt.Errorf("%s: %w", envDataHostKey, err)
	}
	return appdata.Serve(appdata.Options{
		Addr:     *addr,
		Root:     *root,
		Password: os.Getenv(envDataPass),
		HostKey:  seed,
		ReadOnly: *readOnly,
		Adopt:    *adopt,
	})
}

// linkAppData offers Android/data as a target when the phone app runs the
// server, and takes it away again when it no longer does.
func linkAppData(home string) {
	addr := os.Getenv(envDataAddr)
	if addr == "" {
		if err := appdata.Unlink(); err != nil {
			logf("Android/data: %v", err)
		}
		return
	}
	seed, err := base64.StdEncoding.DecodeString(os.Getenv(envDataHostKey))
	if err == nil {
		err = appdata.Link(addr, os.Getenv(envDataPass), seed, filepath.Join(home, "android-data.known_hosts"))
	}
	if err != nil {
		logf("Android/data: %v", err)
	}
}
