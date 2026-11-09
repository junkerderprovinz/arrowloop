package apply

import (
	"fmt"
	"os"
	"testing"

	"golang.org/x/sys/windows"
)

func TestAFileTheCloudClientCouldNotFetchIsNamedAsSuch(t *testing.T) {
	err := fmt.Errorf("copy: %w", &os.PathError{Op: "read", Path: `D:\cloud\photo.jpg`, Err: windows.ERROR_CLOUD_FILE_NOT_IN_SYNC})
	if why := whyFailed(Ends{}, nil, "copy", "stepFailed", err); why.Code != "cloudOnly" {
		t.Fatalf("reason %q, want cloudOnly", why.Code)
	}
}

func TestAnOrdinaryFailureKeepsItsReason(t *testing.T) {
	err := fmt.Errorf("copy: %w", &os.PathError{Op: "read", Path: `D:\photo.jpg`, Err: windows.ERROR_ACCESS_DENIED})
	if why := whyFailed(Ends{}, nil, "copy", "stepFailed", err); why.Code == "cloudOnly" {
		t.Fatal("an access denial was taken for a cloud placeholder")
	}
}
