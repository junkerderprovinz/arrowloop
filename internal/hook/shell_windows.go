package hook

import (
	"context"
	"os/exec"
	"syscall"
)

// shell hands the command line to cmd.exe as written. Go would otherwise
// escape its quotes the C way, which cmd does not read, so any path with a
// space in it would break.
func shell(ctx context.Context, command string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "cmd")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `cmd /S /C "` + command + `"`}
	return cmd
}
