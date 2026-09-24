package shadow

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"golang.org/x/sys/windows"
)

const supported = true

// create takes a shadow copy of a volume through WMI's Win32_ShadowCopy, which
// unlike vssadmin also exists on the client editions of Windows. It returns
// the copy's id and the device path its files are read through.
func create(ctx context.Context, volume string) (id, device string, err error) {
	if !windows.GetCurrentProcessToken().IsElevated() {
		return "", "", ErrNeedsAdmin
	}
	out, err := powershell(ctx, fmt.Sprintf(`
$r = Invoke-CimMethod -ClassName Win32_ShadowCopy -MethodName Create -Arguments @{Volume='%s\'; Context='ClientAccessible'}
if ($r.ReturnValue -ne 0) { [Console]::Error.WriteLine("Win32_ShadowCopy.Create answered $($r.ReturnValue)"); exit 1 }
$s = Get-CimInstance Win32_ShadowCopy -Filter "ID='$($r.ShadowID)'"
"$($s.ID)|$($s.DeviceObject)"`, volume))
	if err != nil {
		return "", "", fmt.Errorf("take a shadow copy of %s: %w", volume, err)
	}
	id, device, ok := strings.Cut(out, "|")
	if !ok || device == "" {
		return "", "", fmt.Errorf("take a shadow copy of %s: unexpected answer %q", volume, out)
	}
	return id, device, nil
}

func remove(ctx context.Context, id string) error {
	_, err := powershell(ctx, fmt.Sprintf(
		`Get-CimInstance Win32_ShadowCopy -Filter "ID='%s'" | Remove-CimInstance`, id))
	return err
}

// powershell runs a script and returns what it printed, or its error output
// in the error.
func powershell(ctx context.Context, script string) (string, error) {
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return "", fmt.Errorf("%w: %s", err, msg)
		}
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
