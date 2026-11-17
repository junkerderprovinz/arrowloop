package remotes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/s3"
)

func configured(t *testing.T, name, backend string, settings map[string]string) {
	t.Helper()
	ownConfig(t)
	if err := Save(name, backend, settings); err != nil {
		t.Fatalf("save %s: %v", name, err)
	}
}

func TestALocalFolderReportsItsDisk(t *testing.T) {
	configured(t, "disk", "local", nil)

	// The working directory rather than a temporary folder, whose Windows path
	// would add a second colon to the remote string.
	usage, err := About(context.Background(), "disk")
	if err != nil {
		t.Fatalf("a local disk refused to report its size: %v", err)
	}
	if !usage.Supported {
		t.Fatal("the local backend was reported as unable to say how full a disk is")
	}
	if usage.Total == nil || *usage.Total <= 0 {
		t.Errorf("a real disk reported a total of %v", usage.Total)
	}
	if usage.Free == nil {
		t.Error("a real disk reported no free space at all, which is not the same as none free")
	}
}

// S3 has no About. An error would mark a healthy bucket red, and a usage of zero
// would read as a full disk.
func TestABackendThatCannotSaySaysSo(t *testing.T) {
	configured(t, "bucket", "s3", map[string]string{
		"provider":          "Other",
		"access_key_id":     "nothing",
		"secret_access_key": "nothing",
		"endpoint":          "http://127.0.0.1:1", // Never connected to: About is refused before any request.
	})

	usage, err := About(context.Background(), "bucket:")
	if err != nil {
		t.Fatalf("a backend without About reported an error: %v", err)
	}
	if usage.Supported {
		t.Fatal("claimed a bucket store can report its size")
	}
	if usage.Total != nil || usage.Free != nil || usage.Used != nil {
		t.Errorf("carried numbers it cannot know: %+v", usage)
	}
}

func TestNothingKnownIsAbsentOnTheWireRatherThanZero(t *testing.T) {
	raw, err := json.Marshal(Usage{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if got := string(raw); got != `{"supported":false}` {
		t.Errorf("an unknown usage travels as %s", got)
	}

	// A full disk has to be reportable.
	zero := int64(0)
	raw, err = json.Marshal(Usage{Supported: true, Free: &zero})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if got := string(raw); got != `{"supported":true,"free":0}` {
		t.Errorf("a genuinely full target travels as %s", got)
	}
}

// davQuota stands in for a WebDAV server that answers the quota question with
// the two figures as given, written the way Nextcloud writes them.
func davQuota(t *testing.T, used, available string) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PROPFIND" {
			http.Error(w, "not here", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.WriteHeader(http.StatusMultiStatus)
		fmt.Fprintf(w, `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
 <d:response>
  <d:href>%s</d:href>
  <d:propstat>
   <d:prop>
    <d:quota-available-bytes>%s</d:quota-available-bytes>
    <d:quota-used-bytes>%s</d:quota-used-bytes>
   </d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
</d:multistatus>`, r.URL.Path, available, used)
	}))
	t.Cleanup(srv.Close)
	return srv.URL + "/remote.php/dav/files/someone/"
}

func nextcloud(t *testing.T, used, available string) Usage {
	t.Helper()
	configured(t, "cloud", "webdav", map[string]string{"url": davQuota(t, used, available), "vendor": "nextcloud", "user": "someone"})
	usage, err := About(context.Background(), "cloud")
	if err != nil {
		t.Fatalf("about: %v", err)
	}
	return usage
}

// Nextcloud clamps a home folder whose size it has not counted to zero and
// leaves mounted storage out of the figure, so an account holding gigabytes
// can say it uses nothing.
func TestAWebDAVServerWithoutAQuotaThatSaysZeroIsNotBelieved(t *testing.T) {
	usage := nextcloud(t, "0", "-3")
	if usage.Supported || usage.Used != nil || usage.Total != nil || usage.Free != nil {
		t.Errorf("an account of unknown size was reported as %+v", usage)
	}
}

// Nextcloud answers zero for both figures when it could not work them out.
func TestAWebDAVServerThatCouldNotCountSaysNothing(t *testing.T) {
	usage := nextcloud(t, "0", "0")
	if usage.Supported || usage.Used != nil || usage.Total != nil || usage.Free != nil {
		t.Errorf("an account that could not be counted was reported as %+v", usage)
	}
}

func TestAnEmptyAccountWithAQuotaStillUsesNothing(t *testing.T) {
	usage := nextcloud(t, "0", "1000")
	if !usage.Supported || usage.Used == nil || *usage.Used != 0 || usage.Total == nil || *usage.Total != 1000 {
		t.Errorf("an empty account with a quota was reported as %+v", usage)
	}
}

func TestAnAccountWithoutAQuotaReportsWhatItHolds(t *testing.T) {
	usage := nextcloud(t, "52000000000", "-3")
	if !usage.Supported || usage.Used == nil || *usage.Used != 52000000000 || usage.Total != nil {
		t.Errorf("an account without a quota was reported as %+v", usage)
	}
}
