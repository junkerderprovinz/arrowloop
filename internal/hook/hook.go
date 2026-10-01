// Package hook runs the commands a job asks for before and after a run.
package hook

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// Timeout is how long one command may take. A command that hangs would hold
// the job's slot, and with it every job queued behind it.
const Timeout = 15 * time.Minute

// outputGrace is how long the output is read after the shell has exited. A
// program the command started in the background keeps the output open for as
// long as it runs, and the run must not wait for it.
const outputGrace = 2 * time.Second

// Run runs command through the system's shell with env added to this
// process's environment. An empty command does nothing. The error carries the
// last lines the command wrote, since that is where a script says why it gave
// up. A timeout or a cancelled context stops the command together with
// everything it started.
func Run(ctx context.Context, command string, env map[string]string) error {
	if strings.TrimSpace(command) == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()

	cmd := shell(ctx, command)
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	cmd.WaitDelay = outputGrace

	err := run(cmd)
	if errors.Is(err, exec.ErrWaitDelay) && ctx.Err() == nil {
		// The shell succeeded and left something running that still holds
		// its output, such as a tunnel the before command opened.
		return nil
	}
	if err == nil {
		return nil
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fmt.Errorf("gave no answer within %s", Timeout)
	}
	if tail := lastLines(out.String(), 3); tail != "" {
		return fmt.Errorf("%w: %s", err, tail)
	}
	return err
}

// lastLines keeps the end of a command's output on one line.
func lastLines(s string, n int) string {
	lines := strings.FieldsFunc(s, func(r rune) bool { return r == '\n' || r == '\r' })
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.TrimSpace(strings.Join(lines, " / "))
}
