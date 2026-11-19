package anomaly

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/jobid"
)

func TestFindingsFromBeforeJobIDsHoldTheJobByTheIDItIsGiven(t *testing.T) {
	path := filepath.Join(t.TempDir(), "anomalies.json")
	old := `[{"id":"x1","job":"fotos","kind":"delete","severity":"warning","held":true,"open":true,"since":"2026-03-01T09:00:00Z","seen":"2026-03-01T09:00:00Z"}]`
	if err := os.WriteFile(path, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if f, ok := s.Holding(jobid.Legacy("fotos")); !ok || f.ID != "x1" {
		t.Errorf("the job's id finds %+v, %v; want the older finding holding it", f, ok)
	}
}

func TestARenamedJobsFindingsTakeItsNewName(t *testing.T) {
	path := filepath.Join(t.TempDir(), "anomalies.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s.Raise(Finding{JobID: "aaaaaaaaaaaa", Job: "fotos", Kind: Delete, Mark: "abc"})
	s.Relabel(map[string]string{"aaaaaaaaaaaa": "bilder"})

	again, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	f, ok := again.Holding("aaaaaaaaaaaa")
	if !ok || f.Job != "bilder" {
		t.Errorf("after the rename the finding says %+v, %v; want it holding the job under its new name", f, ok)
	}
	if _, raised := again.Raise(Finding{JobID: "aaaaaaaaaaaa", Job: "bilder", Kind: Delete, Mark: "abc"}); raised == New {
		t.Error("the same refusal after a rename made a second finding")
	}
}
