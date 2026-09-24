package shadow

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

// A real shadow copy, so it needs the rights the service has. GitHub's Windows
// runners have them.
func TestAShadowCopyShowsAFileAsItWasAndIsRemovedAgain(t *testing.T) {
	if !windows.GetCurrentProcessToken().IsElevated() {
		t.Skip("taking a shadow copy needs administrator rights")
	}
	ctx := context.Background()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("before"), 0o644); err != nil {
		t.Fatal(err)
	}

	s := New()
	frozen, err := s.Root(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("after"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(frozen, "notes.txt"))
	if err != nil {
		t.Fatalf("read through the shadow copy: %v", err)
	}
	if string(got) != "before" {
		t.Errorf("the shadow copy shows %q, want the file as it was when the copy was taken", got)
	}

	id := s.copies[filepath.VolumeName(dir)].id
	if err := s.Close(ctx); err != nil {
		t.Fatal(err)
	}
	left, err := powershell(ctx, `(Get-CimInstance Win32_ShadowCopy -Filter "ID='`+id+`'" | Measure-Object).Count`)
	if err != nil {
		t.Fatal(err)
	}
	if left != "0" {
		t.Errorf("the shadow copy %s is still there after Close", id)
	}
}

func TestWithoutAdministratorRightsNoCopyIsTried(t *testing.T) {
	if windows.GetCurrentProcessToken().IsElevated() {
		t.Skip("this process has administrator rights")
	}
	_, err := New().Root(context.Background(), t.TempDir())
	if !errors.Is(err, ErrNeedsAdmin) {
		t.Errorf("got %v, want ErrNeedsAdmin", err)
	}
}
