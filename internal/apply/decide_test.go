package apply

import (
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

func TestASetAsideNameReadsBackToItsPlainFile(t *testing.T) {
	for _, plain := range []string{
		"notes.txt",
		"docs/report.pdf",
		"archive.tar.gz",
		"Makefile",
		".bashrc",
		"deep/down/a.conflict-left-20250101-000000.txt",
		"Müller/Übersicht.odt",
	} {
		for _, side := range []plan.Side{plan.Left, plan.Right} {
			name := conflictName(plain, side, "20260927-141503")
			got, ok := ParseSetAside(name)
			if !ok {
				t.Errorf("%q was not read back as a set-aside copy", name)
				continue
			}
			if got.Plain != plain || got.Side != side || got.Copy != name {
				t.Errorf("%q read back as %+v, want plain %q on the %s", name, got, plain, side)
			}
			if got.At.Format(runIDLayout) != "20260927-141503" {
				t.Errorf("%q gave the time %s", name, got.At)
			}
		}
	}
}

func TestAnOrdinaryNameIsNoSetAsideCopy(t *testing.T) {
	for _, name := range []string{
		"notes.txt",
		"conflict-left-20260927-141503.txt",
		"notes.conflict-up-20260927-141503.txt",
		"notes.conflict-left-2026-09-27.txt",
		"notes.conflict-left-20261327-141503.txt",
	} {
		if got, ok := ParseSetAside(name); ok {
			t.Errorf("%q was taken for a set-aside copy: %+v", name, got)
		}
	}
}
