// Package jobid names a job for good. A job's name is a label somebody may
// change at any time; its runs, findings and what they taught are kept under
// its id.
package jobid

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
)

// size is the bytes of an id. Ids only have to differ within one
// configuration, and six bytes keep them short enough to read in a file.
const size = 6

// New returns a fresh id for a job somebody just created.
func New() string {
	b := make([]byte, size)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Legacy is the id of a job from before jobs had ids, derived from its name.
// The run log and the findings file the job's old records under the same id,
// so they meet without either having to read the configuration.
func Legacy(name string) string {
	sum := sha256.Sum256([]byte("job:" + name))
	return hex.EncodeToString(sum[:size])
}

// Key is what a record is filed under: the id, or the name for a job built
// without one, as a test or a caller that never read a file builds it.
func Key(id, name string) string {
	if id != "" {
		return id
	}
	return name
}
