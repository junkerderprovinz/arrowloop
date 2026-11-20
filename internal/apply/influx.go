package apply

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// afterCopy says what the two sides read differently once a copy was done, in
// the terms plan.Same compared them by, so a person can check it against the
// files.
func afterCopy(left, right plan.Facts, window time.Duration) string {
	var differ []string
	if left.Size != right.Size && left.Size >= 0 && right.Size >= 0 {
		differ = append(differ, fmt.Sprintf("the size is %d bytes on the left and %d on the right", left.Size, right.Size))
	}
	if left.Hash != "" && right.Hash != "" {
		if left.Hash != right.Hash {
			differ = append(differ, fmt.Sprintf("the checksum is %s on the left and %s on the right", shortSum(left.Hash), shortSum(right.Hash)))
		}
	} else if window != fs.ModTimeNotSupported && left.Mod.Sub(right.Mod).Abs() > window {
		differ = append(differ, fmt.Sprintf("the modification time is %s on the left and %s on the right", stamp(left.Mod), stamp(right.Mod)))
	}
	return "After the copy " + strings.Join(differ, ", ") + "."
}

// rclone's local backend names what changed under a read in its error text
// only; see Update in backend/local/local.go.
var (
	sizeChanged = regexp.MustCompile(`size changed from (\d+) to (\d+)`)
	timeChanged = regexp.MustCompile(`mod time changed from (.+?) to (.+?)\)`)
)

// rcloneTime is how rclone prints the times in that text, time.Time's String.
const rcloneTime = "2006-01-02 15:04:05.999999999 -0700 MST"

// whileRead says what changed while the source was read, from the error the
// copy failed with, or gives the error's own words where they name nothing.
func whileRead(err error) string {
	said := err.Error()
	if m := sizeChanged.FindStringSubmatch(said); m != nil {
		return fmt.Sprintf("While it was read its size changed from %s to %s bytes.", m[1], m[2])
	}
	if m := timeChanged.FindStringSubmatch(said); m != nil {
		return fmt.Sprintf("While it was read its modification time changed from %s to %s.", rcloneStamp(m[1]), rcloneStamp(m[2]))
	}
	return said
}

func rcloneStamp(s string) string {
	t, err := time.Parse(rcloneTime, s)
	if err != nil {
		return s
	}
	return stamp(t)
}

// stamp writes a time to the second, or finer where the fraction is there,
// since a window of less than a second can tell two times apart within one.
func stamp(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04:05.999999999") + " UTC"
}

// shortSum is enough of a checksum to tell two apart and to find it again in
// a tool's output.
func shortSum(sum string) string {
	if len(sum) > 12 {
		return sum[:12]
	}
	return sum
}
