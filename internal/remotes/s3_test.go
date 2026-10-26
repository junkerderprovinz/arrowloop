package remotes

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAnS3EndpointGivesTheRegionItNames(t *testing.T) {
	for endpoint, region := range map[string]string{
		"https://s3.eu-central-1.amazonaws.com":          "eu-central-1",
		"s3-eu-west-1.amazonaws.com":                     "eu-west-1",
		"https://photos.s3.ap-southeast-2.amazonaws.com": "ap-southeast-2",
		"s3.us-west-004.backblazeb2.com":                 "us-west-004",
		"https://fsn1.your-objectstorage.com":            "fsn1",
		"https://s3.fr-par.scw.cloud":                    "fr-par",
		"https://s3.gra.io.cloud.ovh.net":                "gra",
		"https://s3.eu-central-2.wasabisys.com":          "eu-central-2",
		"https://minio.home.lan:9000":                    "",
	} {
		got, _, err := Setup(context.Background(), "s3", map[string]string{"endpoint": endpoint})
		if err != nil || got["region"] != region {
			t.Errorf("%s: region %q, %v; want %q", endpoint, got["region"], err, region)
		}
	}
}

func TestATypedRegionWinsOverTheEndpoint(t *testing.T) {
	got, _, _ := Setup(context.Background(), "s3", map[string]string{"endpoint": "s3.eu-central-1.amazonaws.com", "region": "eu-west-1"})
	if got["region"] != "eu-west-1" {
		t.Fatalf("region %q, want the one typed", got["region"])
	}
}

func TestABucketPastedWithTheEndpointIsTakenApart(t *testing.T) {
	got, _, _ := Setup(context.Background(), "s3", map[string]string{"endpoint": "https://acct.r2.cloudflarestorage.com/backups/"})
	if got["endpoint"] != "https://acct.r2.cloudflarestorage.com" || got[BucketKey] != "backups" {
		t.Fatalf("endpoint %q and bucket %q", got["endpoint"], got[BucketKey])
	}

	got, _, _ = Setup(context.Background(), "s3", map[string]string{"endpoint": "minio:9000/old", BucketKey: "typed"})
	if got["endpoint"] != "minio:9000" || got[BucketKey] != "typed" {
		t.Fatalf("endpoint %q and bucket %q, want the bucket typed", got["endpoint"], got[BucketKey])
	}
}

func TestGarageShowsTheRegionItAssumes(t *testing.T) {
	p, ok := FindProvider("garage")
	if !ok || p.Defaults["region"] != "garage" {
		t.Fatalf("garage's defaults are %v", p.Defaults)
	}
}

// awsAnswers stands in for AWS's global endpoint, which names a bucket's region
// in the answer to a HEAD it refuses.
func awsAnswers(t *testing.T) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead && r.URL.Path == "/frankfurt-photos" {
			w.Header().Set("X-Amz-Bucket-Region", "eu-central-1")
		}
		w.WriteHeader(http.StatusForbidden)
	}))
	t.Cleanup(srv.Close)
	was := awsGlobal
	awsGlobal = srv.URL
	t.Cleanup(func() { awsGlobal = was })
}

func TestAnAWSBucketWithoutARegionGetsTheOneItSitsIn(t *testing.T) {
	awsAnswers(t)
	got, _, err := Setup(context.Background(), "s3", map[string]string{
		"provider": "AWS", "endpoint": "https://s3.amazonaws.com", BucketKey: "frankfurt-photos",
	})
	if err != nil || got["region"] != "eu-central-1" {
		t.Fatalf("region %q, %v; want the bucket's", got["region"], err)
	}
	if got["endpoint"] != "" {
		t.Fatalf("endpoint %q kept, which stops rclone from following the bucket's region", got["endpoint"])
	}
}

func TestAnAWSBucketAWSCannotPlaceKeepsNoRegion(t *testing.T) {
	awsAnswers(t)
	got, _, _ := Setup(context.Background(), "s3", map[string]string{"provider": "AWS", BucketKey: "nowhere"})
	if got["region"] != "" {
		t.Fatalf("region %q for a bucket AWS did not place", got["region"])
	}
}
