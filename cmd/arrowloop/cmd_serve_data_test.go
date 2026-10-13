package main

import (
	"bytes"
	"encoding/base64"
	"os"
	"os/exec"
	"testing"
	"time"
)

// TestMain lets the test binary stand in for arrowloop, so a test can watch a
// command from outside as the phone app does.
func TestMain(m *testing.M) {
	if os.Getenv("ARROWLOOP_TEST_RUN_MAIN") == "1" {
		main()
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestTheDataServerStopsOnceTheAppClosesItsInput(t *testing.T) {
	cmd := exec.Command(os.Args[0], "serve-data", "-addr", "127.0.0.1:0", "-root", t.TempDir(), "-exit-on-eof")
	cmd.Env = append(os.Environ(),
		"ARROWLOOP_TEST_RUN_MAIN=1",
		envDataPass+"=secret",
		envDataHostKey+"="+base64.StdEncoding.EncodeToString(make([]byte, 32)),
	)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	select {
	case err := <-exited:
		t.Fatalf("the server stopped while the app still held its input: %v\n%s", err, out.String())
	case <-time.After(500 * time.Millisecond):
	}

	in.Close()
	select {
	case err := <-exited:
		if err != nil {
			t.Fatalf("the server ended with %v\n%s", err, out.String())
		}
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("the server kept running after the app closed its input")
	}
}
