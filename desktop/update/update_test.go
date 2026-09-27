package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

const assetName = "prog-test-asset"

type fakeRelease struct {
	tag        string
	prerelease bool
	files      map[string][]byte
}

// withSums adds a checksums.txt holding the real hash of every file, then
// applies edit to it.
func (r fakeRelease) withSums(edit func(string) string) fakeRelease {
	var b strings.Builder
	for name, data := range r.files {
		sum := sha256.Sum256(data)
		fmt.Fprintf(&b, "%s  %s\n", hex.EncodeToString(sum[:]), name)
	}
	r.files[ChecksumsFile] = []byte(edit(b.String()))
	return r
}

func keep(s string) string { return s }

// serve stands in for GitHub: the latest-release endpoint and the downloads it
// points at.
func serve(t *testing.T, rel fakeRelease) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("GET /repos/owner/prog/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		type asset struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		}
		body := struct {
			TagName    string  `json:"tag_name"`
			Prerelease bool    `json:"prerelease"`
			Assets     []asset `json:"assets"`
		}{TagName: rel.tag, Prerelease: rel.prerelease, Assets: []asset{}}
		for name := range rel.files {
			body.Assets = append(body.Assets, asset{name, srv.URL + "/download/" + name})
		}
		json.NewEncoder(w).Encode(body)
	})
	mux.HandleFunc("GET /download/{name}", func(w http.ResponseWriter, r *http.Request) {
		data, ok := rel.files[r.PathValue("name")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Write(data)
	})
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// newUpdater points at srv and at a program file in a fresh folder.
func newUpdater(t *testing.T, srv *httptest.Server, version string) *Updater {
	t.Helper()
	dir := t.TempDir()
	prog := filepath.Join(dir, "prog")
	if err := os.WriteFile(prog, []byte("old program"), 0o755); err != nil {
		t.Fatal(err)
	}
	return &Updater{
		Repo:    "owner/prog",
		Version: version,
		Assets:  map[string]string{runtime.GOOS + "/" + runtime.GOARCH: assetName},
		API:     srv.URL,
		Client:  srv.Client(),
		Path:    prog,
		Logf:    t.Logf,
	}
}

func release(tag string) fakeRelease {
	return fakeRelease{tag: tag, files: map[string][]byte{assetName: []byte("new program " + tag)}}
}

func dirEntries(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestCheckOffersANewerRelease(t *testing.T) {
	srv := serve(t, release("v1.4.0").withSums(keep))
	rel, err := newUpdater(t, srv, "v1.3.0").Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if rel == nil || rel.Version != "1.4.0" {
		t.Fatalf("got %+v, want release 1.4.0", rel)
	}
}

func TestCheckIgnoresTheSameOrAnOlderRelease(t *testing.T) {
	for _, tag := range []string{"v1.3.0", "v1.2.9", "v0.9.0"} {
		srv := serve(t, release(tag).withSums(keep))
		rel, err := newUpdater(t, srv, "v1.3.0").Check(context.Background())
		if err != nil || rel != nil {
			t.Errorf("%s: got %+v, %v; want nothing", tag, rel, err)
		}
	}
}

func TestCheckIgnoresPreReleases(t *testing.T) {
	flagged := release("v2.0.0").withSums(keep)
	flagged.prerelease = true
	for _, rel := range []fakeRelease{flagged, release("v2.0.0-rc1").withSums(keep)} {
		srv := serve(t, rel)
		got, err := newUpdater(t, srv, "v1.3.0").Check(context.Background())
		if err != nil || got != nil {
			t.Errorf("%s: got %+v, %v; want nothing", rel.tag, got, err)
		}
	}
}

// scripts/stamp.mjs names an untagged build after git describe, and a build
// from a local checkout is "dev".
func TestCheckRefusesABuildThatIsNoRelease(t *testing.T) {
	srv := serve(t, release("v1.4.0").withSums(keep))
	for _, v := range []string{"", "dev", "v1.3.0-4-g1a2b3c4", "v1.3.0-dirty", "1a2b3c4"} {
		if IsRelease(v) {
			t.Errorf("%q counts as a release", v)
		}
		if _, err := newUpdater(t, srv, v).Check(context.Background()); err == nil {
			t.Errorf("a build with version %q checked for updates", v)
		}
	}
	if !IsRelease("v1.3.0") {
		t.Error("a tag build does not count as a release")
	}
}

func TestCheckFailsWithoutAFileForThisPlatform(t *testing.T) {
	srv := serve(t, release("v1.4.0").withSums(keep))
	u := newUpdater(t, srv, "v1.3.0")
	u.Assets = map[string]string{"plan9/mips": assetName}
	if _, err := u.Check(context.Background()); err == nil {
		t.Error("checked for a platform the program has no file for")
	}

	missing := fakeRelease{tag: "v1.4.0", files: map[string][]byte{"other": []byte("x")}}
	srv = serve(t, missing.withSums(keep))
	if _, err := newUpdater(t, srv, "v1.3.0").Check(context.Background()); err == nil {
		t.Error("offered a release that lacks this platform's file")
	}
}

func TestFetchVerifiesTheChecksum(t *testing.T) {
	cases := []struct {
		name string
		rel  fakeRelease
		ok   bool
	}{
		{"right", release("v1.4.0").withSums(keep), true},
		{"wrong", release("v1.4.0").withSums(func(s string) string {
			return strings.Replace(s, s[:8], "00000000", 1)
		}), false},
		{"not listed", release("v1.4.0").withSums(func(string) string { return "" }), false},
		{"no checksums.txt", release("v1.4.0"), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			u := newUpdater(t, serve(t, c.rel), "v1.3.0")
			rel, err := u.Check(context.Background())
			if err != nil || rel == nil {
				t.Fatalf("check: %+v, %v", rel, err)
			}
			download, err := u.Fetch(context.Background(), rel)
			if !c.ok {
				if err == nil {
					t.Fatal("fetched a file that does not match its checksum")
				}
				if got := dirEntries(t, filepath.Dir(u.Path)); len(got) != 1 {
					t.Fatalf("left %v behind", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(download)
			if err != nil || string(data) != "new program v1.4.0" {
				t.Fatalf("download holds %q, %v", data, err)
			}
			if filepath.Dir(download) != filepath.Dir(u.Path) {
				t.Errorf("downloaded to %s, away from the program", download)
			}
		})
	}
}

func TestAnUpdateReplacesTheProgramAndIsNotFetchedTwice(t *testing.T) {
	u := newUpdater(t, serve(t, release("v1.4.0").withSums(keep)), "v1.3.0")
	ctx := context.Background()
	rel, err := u.Check(ctx)
	if err != nil {
		t.Fatal(err)
	}
	download, err := u.Fetch(ctx, rel)
	if err != nil {
		t.Fatal(err)
	}
	if err := u.Swap(download, rel); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(u.Path); string(data) != "new program v1.4.0" {
		t.Fatalf("program holds %q after the swap", data)
	}
	if again, err := u.Check(ctx); err != nil || again != nil {
		t.Errorf("after staging 1.4.0, check offered %+v, %v", again, err)
	}

	u.Cleanup()
	if got := dirEntries(t, filepath.Dir(u.Path)); len(got) != 1 {
		t.Errorf("cleanup left %v", got)
	}
}

func TestCleanupRemovesTheOldProgramAndStrayDownloads(t *testing.T) {
	dir := t.TempDir()
	prog := filepath.Join(dir, "prog")
	for _, p := range []string{prog, prog + ".old", filepath.Join(dir, downloadPrefix(prog)+"123")} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	(&Updater{Path: prog, Logf: t.Logf}).Cleanup()
	if got := dirEntries(t, dir); len(got) != 1 || got[0] != "prog" {
		t.Errorf("left %v, want only prog", got)
	}
}

func TestParseVersion(t *testing.T) {
	for s, want := range map[string]bool{
		"1.3.0": true, "v1.3.0": true, "10.20.30": true,
		"": false, "dev": false, "1.3": false, "1.3.0-rc1": false, "1.3.0.1": false, "v1.x.0": false,
	} {
		if _, ok := parseVersion(s); ok != want {
			t.Errorf("parseVersion(%q) ok = %v, want %v", s, ok, want)
		}
	}
	a, _ := parseVersion("1.10.0")
	b, _ := parseVersion("1.9.9")
	if compare(a, b) <= 0 {
		t.Error("1.10.0 is not newer than 1.9.9")
	}
}

func TestLookupSumReadsSha256sumOutput(t *testing.T) {
	sums := []byte("ABCDEF  one.exe\n123456 *two.zip\n")
	if got, ok := lookupSum(sums, "one.exe"); !ok || got != "abcdef" {
		t.Errorf("one.exe: %q, %v", got, ok)
	}
	if got, ok := lookupSum(sums, "two.zip"); !ok || got != "123456" {
		t.Errorf("two.zip: %q, %v", got, ok)
	}
	if _, ok := lookupSum(sums, "one"); ok {
		t.Error("matched a name only by its prefix")
	}
}

func workflow(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", ".github", "workflows", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// A platform desktop.yml builds without an entry here is one no copy updates
// on, and an entry for a file of another build would install the wrong
// program.
func TestAssetsCoverEveryDesktopBuild(t *testing.T) {
	slugs := regexp.MustCompile(`(?m)^\s+slug: (\S+)$`).FindAllStringSubmatch(workflow(t, "desktop.yml"), -1)
	if len(slugs) == 0 {
		t.Fatal("desktop.yml: no slug in the matrix")
	}
	covered := map[string]bool{}
	for _, m := range slugs {
		slug := m[1]
		system, arch, ok := strings.Cut(slug, "-")
		if !ok {
			t.Fatalf("desktop.yml: slug %q is not <system>-<arch>", slug)
		}
		if system == "macos" {
			system = "darwin"
		}
		archs := []string{arch}
		if arch == "universal" {
			archs = []string{"amd64", "arm64"}
		}
		for _, a := range archs {
			target := system + "/" + a
			covered[target] = true
			if got := Assets[target]; !strings.HasPrefix(got, "arrowloop-"+slug) {
				t.Errorf("desktop.yml builds %s for %s, but Assets[%q] = %q", slug, target, target, got)
			}
		}
	}
	for target := range Assets {
		if !covered[target] {
			t.Errorf("Assets has %s, which desktop.yml does not build", target)
		}
	}
}

// The updater asks for each file by the name release.yml gives it, and checks
// it against checksums.txt, which the release has to publish over bare names.
func TestTheReleasePublishesEveryAssetWithItsChecksum(t *testing.T) {
	yml := workflow(t, "release.yml")
	published := map[string]bool{}
	for _, m := range regexp.MustCompile(`\sdist/(arrowloop-\S+)`).FindAllStringSubmatch(yml, -1) {
		published[m[1]] = true
	}
	for target, name := range Assets {
		if !published[name] {
			t.Errorf("Assets[%q] = %s, which release.yml does not publish", target, name)
		}
	}
	if !strings.Contains(yml, "(cd dist && sha256sum arrowloop-* > "+ChecksumsFile+")") {
		t.Errorf("release.yml does not write dist/%s over the bare file names", ChecksumsFile)
	}
}
