//go:build !windows

package hook

import (
	"context"
	"os/exec"
	"syscall"
)

func shell(ctx context.Context, command string) *exec.Cmd {
	return exec.CommandContext(ctx, "sh", "-c", command)
}

// run starts the shell in a process group of its own, so stopping it stops
// whatever it started in the background as well.
func run(cmd *exec.Cmd) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	return cmd.Run()
}
