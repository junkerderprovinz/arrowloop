package apply

import (
	"context"
	"time"

	"github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// RunConflictPrefix executes only the first n steps of a conflict resolution,
// so a test can reproduce a crash in the middle with the engine's own steps.
func RunConflictPrefix(ctx context.Context, ends Ends, act plan.Action, runID string, n int) error {
	steps, err := conflictSteps(ends, act, runID, 0)
	if err != nil {
		return err
	}
	for i, s := range steps {
		if i >= n {
			break
		}
		if err := s.do(ctx); err != nil {
			return err
		}
	}
	return nil
}

// ConflictStepCount reports how many steps a resolution takes, so a test can
// cover every crash point without hard-coding the number.
func ConflictStepCount() int { return 3 }

// UploadStamped makes f a destination like MEGA, which keeps no times and no
// checksums and reports uploaded as every file's time.
func UploadStamped(f fs.Fs, uploaded time.Time) fs.Fs {
	return uploadStamped{Fs: f, uploaded: uploaded}
}
