package remotes

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rclone/gofakes3"
	"github.com/rclone/gofakes3/s3mem"

	_ "github.com/rclone/rclone/backend/s3"
)

// oneBucketKey runs an S3 server whose key may open the bucket backups but not
// list the buckets, as a Cloudflare R2 object token does, and returns the
// settings that reach it.
func oneBucketKey(t *testing.T) map[string]string {
	t.Helper()
	const key, secret = "arrowloop-test", "arrowloop-secret"
	backend := s3mem.New()
	if err := backend.CreateBucket(t.Context(), "backups"); err != nil {
		t.Fatal(err)
	}
	faker := gofakes3.New(backend, gofakes3.WithV4Auth(map[string]string{key: secret})).Server()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`))
			return
		}
		faker.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	return map[string]string{
		"provider": "Other", "access_key_id": key, "secret_access_key": secret,
		"endpoint": srv.URL, "force_path_style": "true",
	}
}

func TestAKeyForOneBucketPassesTheTestInsideIt(t *testing.T) {
	settings := oneBucketKey(t)
	if err := CheckSettings(context.Background(), "s3", settings); err == nil {
		t.Fatal("the list of all buckets was not refused, so this test proves nothing")
	}
	settings[BucketKey] = "backups"
	if err := CheckSettings(context.Background(), "s3", settings); err != nil {
		t.Fatalf("the test of the bucket the key may open failed: %v", err)
	}
	settings[BucketKey] = "elsewhere"
	if err := CheckSettings(context.Background(), "s3", settings); err == nil {
		t.Fatal("a bucket that does not exist passed the test")
	}
}

func TestASavedTargetForOneBucketIsCheckedAndBrowsedInsideIt(t *testing.T) {
	ownConfig(t)
	const name = "arrowloop-test-one-bucket"
	settings := oneBucketKey(t)
	settings[BucketKey] = "backups"
	if err := Save(name, "s3", settings); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = Delete(name) })

	if err := Check(context.Background(), name); err != nil {
		t.Fatalf("the check of a target for one bucket failed: %v", err)
	}
	if Root(name) != "backups" || Parent(name, "backups") != "" {
		t.Fatalf("the target opens at %q and goes up from it to %q", Root(name), Parent(name, "backups"))
	}
	if _, err := MakeFolder(context.Background(), name, Root(name), "photos"); err != nil {
		t.Fatalf("make a folder in the bucket: %v", err)
	}
}

func TestTheBucketStaysOutOfRclonesOwnSettings(t *testing.T) {
	got := connectionString("s3", map[string]string{"provider": "Other", BucketKey: "backups"})
	if got != ":s3,provider=Other:" {
		t.Fatalf("connection string %s", got)
	}
}
