//go:build !windows

package main

import (
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
)

// Away from Windows there is no condition.
//
// Not an omission and not a stub to fill in later. Both questions this answers
// on Windows ("is this machine on battery", "is this connection one somebody
// pays for by the megabyte") have no portable answer, and the two settings that
// ask them are only ever shown by the Windows build.
//
// Returning nil rather than a function that always says yes is deliberate: the
// runner skips the call entirely when there is no condition, so a build that
// cannot answer does not pay for asking, and there is no code path where a
// silently-always-true check could start holding runs back.
func powerCondition(_ *deskset.Store) daemon.Condition { return nil }
