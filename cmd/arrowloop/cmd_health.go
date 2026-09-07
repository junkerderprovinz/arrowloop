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

// defaultAddr is where the interface listens.
//
// Loopback on purpose: this interface can start a job that deletes files and
// has no login of its own, so reaching it from elsewhere has to be somebody's
// explicit decision. Inside a container that decision is already made by
// whoever publishes the port, which is why the image sets ARROWLOOP_ADDR to
// 0.0.0.0 instead of carrying a second default in the code.
func defaultAddr() string {
	if fromEnv := strings.TrimSpace(os.Getenv("ARROWLOOP_ADDR")); fromEnv != "" {
		return fromEnv
	}
	return "127.0.0.1:8422"
}

// cmdHealth answers the container healthcheck.
//
// It asks the API a real question rather than checking that a port is open. A
// process can hold a socket long after it has stopped being able to do anything
// useful, and a healthcheck that only proves the socket exists reports such a
// container as healthy for as long as it takes somebody to notice by hand.
func cmdHealth(ctx context.Context, args []string) error {
	fset := flag.NewFlagSet("healthcheck", flag.ExitOnError)
	addr := fset.String("addr", defaultAddr(), "where the interface is listening")
	if err := fset.Parse(args); err != nil {
		return err
	}

	target := *addr
	// 0.0.0.0 is an address to listen on, not one to connect to. A healthcheck
	// that dials it works on Linux and fails on other stacks, which is the kind
	// of difference that only shows up on somebody else's machine.
	if host, port, found := strings.Cut(target, ":"); found && (host == "" || host == "0.0.0.0" || host == "::") {
		target = "127.0.0.1:" + port
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	// /api/session rather than /api/jobs, and the reason is not cosmetic. Once a
	// password is set, every route but three needs a session, and a healthcheck
	// carries no cookie: asking for the job list would answer 401 and the
	// container would go unhealthy every thirty seconds on a machine where
	// nothing at all is wrong. This route is open on every install and answers
	// 200 whether or not a password is set, which is exactly what a liveness
	// check should be asking.
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
