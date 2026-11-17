package daemon

import (
	"context"
	"errors"
	"fmt"

	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
)

// ErrVPNDown is a run of a job that goes through the VPN whose tunnel did not
// come up. Nothing was synced, since the run would otherwise have gone out
// over the machine's own network.
var ErrVPNDown = errors.New("the VPN did not come up, so the run did not start")

// ErrNoVPN is a job that goes through the VPN on an engine that has none, as
// on a phone, where the system's own VPN covers every app.
var ErrNoVPN = errors.New("this job goes through the VPN, and ArrowLoop has no built-in VPN here")

// ErrVPNRefused is a job that goes through the VPN with a side whose
// connections the VPN cannot carry.
var ErrVPNRefused = errors.New("this job goes through the VPN, but one of its sides cannot")

// SetVPN gives the runner the built-in VPN for the jobs that go through it.
// Without one, every run of such a job fails with ErrNoVPN.
func (r *Runner) SetVPN(m *vpnconn.Manager) {
	r.mu.Lock()
	r.vpn = m
	r.mu.Unlock()
}

// ThroughVPN returns the context a job's connections are made with: for a job
// that goes through the VPN, one that sends them all into the tunnel, which it
// holds up until done is called. It fails rather than hand back a context
// whose connections would leave past the tunnel.
func (r *Runner) ThroughVPN(ctx context.Context, j job.Job) (_ context.Context, done func(), err error) {
	if !j.VPN {
		return ctx, func() {}, nil
	}
	r.mu.Lock()
	m := r.vpn
	r.mu.Unlock()
	if m == nil {
		return nil, nil, ErrNoVPN
	}
	for _, side := range []struct{ name, spec string }{{"left", j.Left}, {"right", j.Right}} {
		path, rerr := volume.Resolve(side.spec)
		if rerr != nil {
			// A drive that is not attached is a folder on this machine, which
			// makes no connection.
			continue
		}
		if err := vpnconn.Unroutable(path); err != nil {
			return nil, nil, fmt.Errorf("%w: the %s side: %w", ErrVPNRefused, side.name, err)
		}
	}
	lease, err := m.Acquire(ctx, j.Name)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %w", ErrVPNDown, err)
	}
	return lease.Context(ctx), lease.Release, nil
}
