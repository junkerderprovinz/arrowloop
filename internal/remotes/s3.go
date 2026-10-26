package remotes

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/rclone/rclone/fs/fshttp"
)

// regionInHost reads the region out of the endpoints that name it.
var regionInHost = []*regexp.Regexp{
	// s3.eu-central-1.amazonaws.com and s3-eu-west-1.amazonaws.com, also with
	// a bucket's own name in front.
	regexp.MustCompile(`(?:^|\.)s3[.-](?:dualstack\.)?([a-z]{2}(?:-[a-z]+)+-\d+)\.amazonaws\.com$`),
	regexp.MustCompile(`^s3\.([a-z]+-[a-z]+-\d+)\.backblazeb2\.com$`),
	regexp.MustCompile(`^([a-z]+\d+)\.your-objectstorage\.com$`),
	regexp.MustCompile(`^s3\.([a-z]+-[a-z]+)\.scw\.cloud$`),
	regexp.MustCompile(`^s3\.([a-z]+)\.(?:io|perf)\.cloud\.ovh\.net$`),
	regexp.MustCompile(`^s3\.([a-z]+-[a-z]+-\d+)\.wasabisys\.com$`),
}

// tidyS3 takes apart an endpoint pasted the way a console shows a bucket's
// address, as Cloudflare's R2 dashboard does: the path is the bucket, and a
// host that names its region gives the region. Whatever the form already has
// wins.
func tidyS3(settings map[string]string) {
	endpoint := strings.TrimSpace(settings["endpoint"])
	if endpoint == "" {
		return
	}
	scheme, rest, found := strings.Cut(endpoint, "://")
	if !found {
		scheme, rest = "", endpoint
	}
	host, path, _ := strings.Cut(rest, "/")
	if bucket, _, _ := strings.Cut(path, "/"); bucket != "" && strings.TrimSpace(settings[BucketKey]) == "" {
		settings[BucketKey] = bucket
	}
	settings["endpoint"] = host
	if scheme != "" {
		settings["endpoint"] = scheme + "://" + host
	}

	if strings.TrimSpace(settings["region"]) != "" {
		return
	}
	bare, _, _ := strings.Cut(strings.ToLower(host), ":")
	for _, re := range regionInHost {
		if m := re.FindStringSubmatch(bare); m != nil {
			settings["region"] = m[1]
			return
		}
	}
}

// awsGlobal is AWS's endpoint for every region, which answers a HEAD of any
// bucket with the bucket's region, even when it refuses the request.
var awsGlobal = "https://s3.amazonaws.com"

// awsRegion gives an AWS target without a region the one its bucket sits in.
// rclone signs for us-east-1 when it knows none, and AWS refuses a bucket
// elsewhere. rclone follows a bucket's region by itself only without an
// endpoint, so the global one, which rclone uses anyway, is dropped.
func awsRegion(ctx context.Context, settings map[string]string) {
	if settings["provider"] != "AWS" {
		return
	}
	host := strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(settings["endpoint"], "https://"), "http://"), "/")
	if strings.EqualFold(host, "s3.amazonaws.com") {
		settings["endpoint"] = ""
	}
	bucket := strings.Trim(settings[BucketKey], "/")
	if strings.TrimSpace(settings["region"]) != "" || bucket == "" || settings["endpoint"] != "" {
		return
	}
	if region := bucketRegion(ctx, bucket); region != "" {
		settings["region"] = region
	}
}

// bucketRegion asks AWS where a bucket is, or returns "" when it cannot say.
// rclone then still follows the bucket's region on its own.
func bucketRegion(ctx context.Context, bucket string) string {
	ctx, stop := context.WithTimeout(ctx, 10*time.Second)
	defer stop()
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, awsGlobal+"/"+url.PathEscape(bucket), nil)
	if err != nil {
		return ""
	}
	resp, err := fshttp.NewClient(ctx).Do(req)
	if err != nil {
		return ""
	}
	_ = resp.Body.Close()
	return resp.Header.Get("X-Amz-Bucket-Region")
}
