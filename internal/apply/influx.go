package apply

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// afterCopy says what the two sides read differently once a copy was done, in
// the terms plan.Same compared them by, so a person can check it against the
// files. The values are the same facts for an interface to word: leftSize and
// rightSize in bytes, leftSum and rightSum, leftTime and rightTime.
func afterCopy(left, right plan.Facts, window time.Duration) (string, []string) {
	var differ, facts []string
	if left.Size != right.Size && left.Size >= 0 && right.Size >= 0 {
		differ = append(differ, fmt.Sprintf("the size is %d bytes on the left and %d on the right", left.Size, right.Size))
		facts = append(facts, "leftSize", strconv.FormatInt(left.Size, 10), "rightSize", strconv.FormatInt(right.Size, 10))
	}
	if left.Hash != "" && right.Hash != "" {
		if left.Hash != right.Hash {
			differ = append(differ, fmt.Sprintf("the checksum is %s on the left and %s on the right", shortSum(left.Hash), shortSum(right.Hash)))
			facts = append(facts, "leftSum", shortSum(left.Hash), "rightSum", shortSum(right.Hash))
		}
	} else if window != fs.ModTimeNotSupported && left.Mod.Sub(right.Mod).Abs() > window {
		differ = append(differ, fmt.Sprintf("the modification time is %s on the left and %s on the right", stamp(left.Mod), stamp(right.Mod)))
		facts = append(facts, "leftTime", moment(left.Mod), "rightTime", moment(right.Mod))
	}
	return "After the copy " + strings.Join(differ, ", ") + ".", facts
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
// The values are sizeFrom and sizeTo in bytes, or timeFrom and timeTo.
func whileRead(err error) (string, []string) {
	said := err.Error()
	if m := sizeChanged.FindStringSubmatch(said); m != nil {
		return fmt.Sprintf("While it was read its size changed from %s to %s bytes.", m[1], m[2]), []string{"sizeFrom", m[1], "sizeTo", m[2]}
	}
	if m := timeChanged.FindStringSubmatch(said); m != nil {
		text := fmt.Sprintf("While it was read its modification time changed from %s to %s.", rcloneStamp(m[1]), rcloneStamp(m[2]))
		from, fromErr := time.Parse(rcloneTime, m[1])
		to, toErr := time.Parse(rcloneTime, m[2])
		if fromErr != nil || toErr != nil {
			return text, nil
		}
		return text, []string{"timeFrom", moment(from), "timeTo", moment(to)}
	}
	return said, nil
}

// sinceScan says how a source differs from what the scan saw, in the words
// and values whileRead gives, or returns "" for one that is as it was.
func sinceScan(ctx context.Context, seen *scan.Entry, now fs.Object, window time.Duration) (string, []string) {
	if seen == nil {
		return "", nil
	}
	var said, facts []string
	if size := now.Size(); size != seen.Size {
		said = append(said, fmt.Sprintf("While it was read its size changed from %d to %d bytes.", seen.Size, size))
		facts = append(facts, "sizeFrom", strconv.FormatInt(seen.Size, 10), "sizeTo", strconv.FormatInt(size, 10))
	}
	if mod := now.ModTime(ctx); window != fs.ModTimeNotSupported && mod.Sub(seen.Mod).Abs() > window {
		said = append(said, fmt.Sprintf("While it was read its modification time changed from %s to %s.", stamp(seen.Mod), stamp(mod)))
		facts = append(facts, "timeFrom", moment(seen.Mod), "timeTo", moment(mod))
	}
	return strings.Join(said, " "), facts
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

// moment is a time as an interface reads it back, to the nanosecond.
func moment(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

// shortSum is enough of a checksum to tell two apart and to find it again in
// a tool's output.
func shortSum(sum string) string {
	if len(sum) > 12 {
		return sum[:12]
	}
	return sum
}
