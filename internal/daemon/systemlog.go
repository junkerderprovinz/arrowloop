package daemon

import (
	"github.com/junkerderprovinz/arrowloop/internal/failure"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/systemlog"
)

// SetSystemLog notes the runs that could not reach a server, and the
// notifications that did not go out, in l.
func (r *Runner) SetSystemLog(l *systemlog.Log) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.system = l
}

func (r *Runner) systemLog() *systemlog.Log {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.system
}

// trouble logs a line and notes it in the system log as coming from source.
func (r *Runner) trouble(source, format string, args ...any) {
	r.log(format, args...)
	r.systemLog().Note(source, format, args...)
}

// unreached are the failures of a run that are about getting to the server
// rather than about the files.
var unreached = map[string]bool{
	failure.Unreachable:          true,
	failure.SignInFailed:         true,
	failure.SignInAgain:          true,
	failure.TwoFactorRefused:     true,
	failure.HostKeyChanged:       true,
	failure.TooManyLogins:        true,
	failure.CertificateUntrusted: true,
	failure.RateLimited:          true,
	failure.VPNDown:              true,
	failure.VPNUnreached:         true,
	failure.VPNRefused:           true,
}

func (r *Runner) noteUnreached(rec history.Run) {
	if f := failure.Of(rec.Err); f != nil && unreached[f.Code] {
		r.systemLog().Note(systemlog.Connection, "%s: %s", rec.Job, rec.Err)
	}
}
