package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

// defaultAddr is where the interface listens. It defaults to loopback because
// the interface can start jobs that delete files; the container image sets
// ARROWLOOP_ADDR to 0.0.0.0.
func defaultAddr() string {
	if fromEnv := strings.TrimSpace(os.Getenv("ARROWLOOP_ADDR")); fromEnv != "" {
		return fromEnv
	}
	return "127.0.0.1:8422"
}

// cmdHealth answers the container healthcheck by asking the API a question,
// since an open port alone does not prove the process still works.
func cmdHealth(ctx context.Context, args []string) error {
	fset := flag.NewFlagSet("healthcheck", flag.ExitOnError)
	addr := fset.String("addr", defaultAddr(), "where the interface is listening")
	if err := fset.Parse(args); err != nil {
		return err
	}

	target := *addr
	// 0.0.0.0 is an address to listen on; dialling it only works on Linux.
	if host, port, found := strings.Cut(target, ":"); found && (host == "" || host == "0.0.0.0" || host == "::") {
		target = "127.0.0.1:" + port
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	// /api/session answers 200 without a session cookie even when a password
	// is set, which most routes do not.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+target+"/api/session", nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("the interface answered %s", resp.Status)
	}
	return nil
}
