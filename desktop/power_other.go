//go:build !windows

package main

import (
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
)

// powerCondition returns nil away from Windows: battery and metered connections
// have no portable answer, and only the Windows build shows those settings. The
// runner skips a nil condition entirely.
func powerCondition(_ *deskset.Store) daemon.Condition { return nil }
