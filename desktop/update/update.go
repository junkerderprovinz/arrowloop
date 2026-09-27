// Package update keeps the desktop app current from ArrowLoop's GitHub
// releases. It finds a newer published release, downloads this platform's
// file, checks it against the release's checksums.txt and puts it where the
// next start picks it up, leaving the running program alone.
package update

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
)

// Repo is where ArrowLoop's releases are published.
const Repo = "junkerderprovinz/arrowloop"

// ChecksumsFile is the release file listing the SHA-256 of every other file,
// in the format sha256sum writes.
const ChecksumsFile = "checksums.txt"

// Assets names each platform's file as release.yml publishes it, without the
// version in its name. Windows takes the bare program rather than the
// installer, so an installed copy and a portable one update the same way. Both
// Macs take the universal bundle.
var Assets = map[string]string{
	"windows/amd64": "arrowloop-windows-amd64-portable.exe",
	"windows/arm64": "arrowloop-windows-arm64-portable.exe",
	"darwin/amd64":  "arrowloop-macos-universal.zip",
	"darwin/arm64":  "arrowloop-macos-universal.zip",
	"linux/amd64":   "arrowloop-linux-amd64",
}

// Updater holds what an update needs to know about the program. API, Client
// and Path fall back to GitHub, http.DefaultClient and the running program.
type Updater struct {
	// Repo is "owner/name" on GitHub.
	Repo string
	// Version is the running version, such as "v1.3.0".
	Version string
	// Assets maps "GOOS/GOARCH" to the name of that platform's release file.
	// A platform without an entry is never updated.
	Assets map[string]string
	// UninstallKey names the entry under
	// HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall whose
	// DisplayVersion follows an update of the installed copy.
	UninstallKey string

	API    string
	Client *http.Client
	// Path is the file, or on macOS the .app bundle, that an update replaces.
	Path string
	// Logf receives what Cleanup and Swap could not do but did not fail on.
	Logf func(format string, args ...any)

	// staged is the version Swap put in place during this run, so a later
	// Check does not fetch it again.
	staged string
}

// Release is a newer release with a file for this platform.
type Release struct {
	Version string
	asset   string
	url     string
	sumsURL string
}

type githubRelease struct {
	TagName    string `json:"tag_name"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

// IsRelease reports whether version names a release an update can start from.
// A build from an untagged or edited tree carries git describe's suffix and is
// not one.
func IsRelease(version string) bool {
	_, ok := parseVersion(version)
	return ok
}

// Newer reports whether a and b are both release versions and a is the newer.
func Newer(a, b string) bool {
	va, ok := parseVersion(a)
	if !ok {
		return false
	}
	vb, ok := parseVersion(b)
	return ok && compare(va, vb) > 0
}

// Check asks GitHub for the newest published release. It returns nil when that
// release is no newer than the running version or than one already staged.
func (u *Updater) Check(ctx context.Context) (*Release, error) {
	current, ok := parseVersion(u.Version)
	if !ok {
		return nil, fmt.Errorf("running version %q is not a release version", u.Version)
	}
	if staged, ok := parseVersion(u.staged); ok {
		current = staged
	}
	name := u.Assets[runtime.GOOS+"/"+runtime.GOARCH]
	if name == "" {
		return nil, fmt.Errorf("no release file for %s/%s", runtime.GOOS, runtime.GOARCH)
	}

	body, err := u.get(ctx, u.api()+"/repos/"+u.Repo+"/releases/latest", 1<<20)
	if err != nil {
		return nil, err
	}
	var gr githubRelease
	if err := json.Unmarshal(body, &gr); err != nil {
		return nil, fmt.Errorf("reading the latest release: %w", err)
	}
	// A release flagged as a pre-release, or tagged like one (1.4.0-rc1), is
	// never offered.
	latest, ok := parseVersion(gr.TagName)
	if gr.Prerelease || !ok || compare(latest, current) <= 0 {
		return nil, nil
	}

	rel := &Release{Version: strings.TrimPrefix(gr.TagName, "v"), asset: name}
	for _, a := range gr.Assets {
		switch a.Name {
		case name:
			rel.url = a.URL
		case ChecksumsFile:
			rel.sumsURL = a.URL
		}
	}
	if rel.url == "" {
		return nil, fmt.Errorf("release %s has no %s", gr.TagName, name)
	}
	return rel, nil
}

// Fetch downloads the release's file into the folder the program sits in, so
// Swap can move it with a rename, and verifies it against checksums.txt. A
// folder the user cannot write to, as under Program Files or on a read-only
// mount, fails here before anything is downloaded.
func (u *Updater) Fetch(ctx context.Context, rel *Release) (string, error) {
	target, err := u.target()
	if err != nil {
		return "", err
	}
	f, err := os.CreateTemp(filepath.Dir(target), downloadPrefix(target)+"*")
	if err != nil {
		return "", fmt.Errorf("cannot write next to %s: %w", target, err)
	}
	keep := false
	defer func() {
		f.Close()
		if !keep {
			os.Remove(f.Name())
		}
	}()

	if rel.sumsURL == "" {
		return "", fmt.Errorf("release %s has no %s", rel.Version, ChecksumsFile)
	}
	sums, err := u.get(ctx, rel.sumsURL, 1<<20)
	if err != nil {
		return "", err
	}
	want, ok := lookupSum(sums, rel.asset)
	if !ok {
		return "", fmt.Errorf("%s of release %s lists no checksum for %s", ChecksumsFile, rel.Version, rel.asset)
	}

	resp, err := u.open(ctx, rel.url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(f, h), resp.Body); err != nil {
		return "", fmt.Errorf("downloading %s: %w", rel.asset, err)
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != want {
		return "", fmt.Errorf("%s has checksum %s, but %s says %s", rel.asset, got, ChecksumsFile, want)
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	keep = true
	return f.Name(), nil
}

func (u *Updater) api() string {
	if u.API != "" {
		return strings.TrimSuffix(u.API, "/")
	}
	return "https://api.github.com"
}

func (u *Updater) open(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", path.Base(u.Repo)+"/"+u.Version)
	req.Header.Set("Accept", "application/vnd.github+json, application/octet-stream")
	client := u.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	return resp, nil
}

func (u *Updater) get(ctx context.Context, url string, limit int64) ([]byte, error) {
	resp, err := u.open(ctx, url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(io.LimitReader(resp.Body, limit))
}

func (u *Updater) logf(format string, args ...any) {
	if u.Logf != nil {
		u.Logf(format, args...)
	}
}

// lookupSum finds name in the output of sha256sum, where a "*" before the name
// marks binary mode.
func lookupSum(sums []byte, name string) (string, bool) {
	sc := bufio.NewScanner(bytes.NewReader(sums))
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == name {
			return strings.ToLower(fields[0]), true
		}
	}
	return "", false
}

type version [3]int

// parseVersion reads "1.2.3" or "v1.2.3". Anything else, "dev", a commit hash
// and a pre-release or git describe suffix included, is not a version an
// update may go to or start from.
func parseVersion(s string) (version, bool) {
	parts := strings.Split(strings.TrimPrefix(s, "v"), ".")
	if len(parts) != 3 {
		return version{}, false
	}
	var v version
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return version{}, false
		}
		v[i] = n
	}
	return v, true
}

func compare(a, b version) int {
	return slices.Compare(a[:], b[:])
}
