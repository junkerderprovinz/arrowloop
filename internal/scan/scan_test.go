package scan

import "testing"

// TestTheOldReservedNameStaysReserved guards the rename of the tool.
//
// A tree an older build already synced still holds a .reeveroll directory with
// a trash can inside it, and that directory has no row in the state database,
// because back then it was skipped for exactly this reason. Stop reserving the
// name and the next run reads it as a folder somebody just created: the engine
// copies a can full of deleted files onto the other side, and from then on both
// sides have one and neither will ever let go of it.
func TestTheOldReservedNameStaysReserved(t *testing.T) {
	for _, rel := range []string{
		MetaDir,
		MetaDir + "/trash/2026-09-06T03-00-00/gone.txt",
		legacyMetaDir,
		legacyMetaDir + "/trash/2026-09-01T12-00-00/gone.txt",
		legacyMetaDir + "/volume.json",
	} {
		if !IsReserved(rel) {
			t.Errorf("%q belongs to the tool and must never be synced", rel)
		}
	}

	// The guard has to stay narrow in both directions. A file the user owns
	// must not vanish from a sync because its name happens to start with the
	// same letters, and the reserved directory is the one at the root of the
	// job: a folder of that name further down is the user's business.
	for _, rel := range []string{
		"notes.txt",
		".arrowloopish/notes.txt",
		".reeverolling/notes.txt",
		"projects/.arrowloop/notes.txt",
	} {
		if IsReserved(rel) {
			t.Errorf("%q is the user's data and must be synced", rel)
		}
	}
}
