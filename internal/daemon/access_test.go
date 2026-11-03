package daemon_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/failure"
)

func TestARunOnFoldersThePhoneWithholdsFailsAndSaysWhy(t *testing.T) {
	r, right := condSandbox(t)
	r.SetAccess(func(string) error { return daemon.ErrNoFileAccess })

	rec, err := r.Run(context.Background(), "x")
	if !errors.Is(err, daemon.ErrNoFileAccess) {
		t.Fatalf("the run ended with %v, want the missing file access", err)
	}
	if !rec.Failed() {
		t.Error("the run was recorded as a success")
	}
	if got := failure.Of(rec.Err); got == nil || got.Code != failure.NoFileAccess || got.Params["side"] != "left" {
		t.Errorf("Of(%q) = %+v, want the missing file access on the left side", rec.Err, got)
	}
	if _, statErr := os.Stat(filepath.Join(right, "a.txt")); statErr == nil {
		t.Error("the run wrote although it could not read")
	}
}

func TestAPreviewOnFoldersThePhoneWithholdsSaysWhy(t *testing.T) {
	r, _ := condSandbox(t)
	r.SetAccess(func(string) error { return daemon.ErrNoFileAccess })
	if _, err := r.Preview(context.Background(), "x"); !errors.Is(err, daemon.ErrNoFileAccess) {
		t.Fatalf("the preview ended with %v, want the missing file access", err)
	}
}

func TestGrantedAccessLetsTheRunThrough(t *testing.T) {
	r, right := condSandbox(t)
	var asked []string
	r.SetAccess(func(path string) error {
		asked = append(asked, path)
		return nil
	})
	if _, err := r.Run(context.Background(), "x"); err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(asked) != 2 {
		t.Errorf("asked about %v, want both folders", asked)
	}
	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Errorf("the file was not copied: %v", err)
	}
}
