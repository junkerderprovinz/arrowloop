package remotes

import (
	"regexp"
	"strings"
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
