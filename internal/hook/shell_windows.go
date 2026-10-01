package hook

import (
	"context"
	"fmt"
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// shell hands the command line to cmd.exe as written. Go would otherwise
// escape its quotes the C way, which cmd does not read, so any path with a
// space in it would break.
func shell(ctx context.Context, command string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "cmd")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `cmd /S /C "` + command + `"`}
	return cmd
}

var resumeProcess = windows.NewLazySystemDLL("ntdll.dll").NewProc("NtResumeProcess")

// run puts the shell in a job object, which every process it starts joins, so
// stopping it stops what it started in the background as well. The shell is
// started suspended and only let go once it is in the job, or a quick command
// could start something before then. The job is not set to kill on close, so
// a helper a successful command leaves running keeps running.
func run(cmd *exec.Cmd) error {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return fmt.Errorf("create a job object: %w", err)
	}
	defer windows.CloseHandle(job)

	cmd.SysProcAttr.CreationFlags |= windows.CREATE_SUSPENDED
	cmd.Cancel = func() error { return windows.TerminateJobObject(job, 1) }
	if err := cmd.Start(); err != nil {
		return err
	}
	if err := enter(job, cmd.Process.Pid); err != nil {
		cmd.Process.Kill()
		cmd.Wait()
		return err
	}
	return cmd.Wait()
}

// enter moves a suspended process into the job and lets it run.
func enter(job windows.Handle, pid int) error {
	const access = windows.PROCESS_SET_QUOTA | windows.PROCESS_TERMINATE | windows.PROCESS_SUSPEND_RESUME
	h, err := windows.OpenProcess(access, false, uint32(pid))
	if err != nil {
		return fmt.Errorf("open the command's shell: %w", err)
	}
	defer windows.CloseHandle(h)
	if err := windows.AssignProcessToJobObject(job, h); err != nil {
		return fmt.Errorf("put the command's shell in a job object: %w", err)
	}
	if status, _, _ := resumeProcess.Call(uintptr(h)); status != 0 {
		return fmt.Errorf("start the command's shell: NTSTATUS %#x", status)
	}
	return nil
}
