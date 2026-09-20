package scan

import "testing"

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

	// Only the directories at the root of the job are reserved, and only by
	// their exact names.
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
