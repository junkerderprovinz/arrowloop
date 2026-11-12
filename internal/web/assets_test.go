package web_test

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// uiFS is a stand-in for the embedded interface: an index that names one
// content-hashed bundle, which is exactly the shape Vite produces.
func uiFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":           &fstest.MapFile{Data: []byte(`<html><script src="/assets/index-AAA.js"></script></html>`)},
		"assets/index-AAA.js":  &fstest.MapFile{Data: []byte("console.log(1)")},
		"assets/index-AAA.css": &fstest.MapFile{Data: []byte("body{}")},
	}
}

// An embedded file has no modification time, so without an ETag a browser can
// keep showing an old build.
func TestTheInterfaceCarriesAValidator(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, UI: uiFS()})

	for _, path := range []string{"/", "/index.html", "/assets/index-AAA.js"} {
		resp, err := srv.Client().Get(srv.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		resp.Body.Close()
		if resp.Header.Get("ETag") == "" {
			t.Errorf("%s came back with no ETag, so a browser can never tell it changed", path)
		}
		if resp.Header.Get("Cache-Control") == "" {
			t.Errorf("%s came back with no Cache-Control", path)
		}
	}
}

// index.html names the other files and is revalidated on every load; a
// content-hashed bundle changes its name when it changes and may be kept.
func TestTheTwoCacheRulesPullApartOnPurpose(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, UI: uiFS()})

	page, err := srv.Client().Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	page.Body.Close()
	if got := page.Header.Get("Cache-Control"); got != "no-cache" {
		t.Errorf("index.html says %q; it has to be revalidated every time", got)
	}

	asset, err := srv.Client().Get(srv.URL + "/assets/index-AAA.js")
	if err != nil {
		t.Fatal(err)
	}
	asset.Body.Close()
	if got := asset.Header.Get("Cache-Control"); got == "no-cache" || got == "" {
		t.Errorf("a fingerprinted bundle says %q; it should be cacheable for a long time", got)
	}
}

// Without a 304, revalidating on every load would download everything again.
func TestAValidatorActuallySavesTheTransfer(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, UI: uiFS()})

	first, err := srv.Client().Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	first.Body.Close()
	tag := first.Header.Get("ETag")
	if tag == "" {
		t.Fatal("no ETag to send back")
	}

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/", nil)
	req.Header.Set("If-None-Match", tag)
	second, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Body.Close()
	if second.StatusCode != http.StatusNotModified {
		t.Errorf("a conditional request answered %s rather than 304", second.Status)
	}
}

// One tag for everything would validate a real change as unchanged.
func TestTwoDifferentFilesGetTwoDifferentTags(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, UI: uiFS()})

	tagOf := func(path string) string {
		resp, err := srv.Client().Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.Header.Get("ETag")
	}
	js := tagOf("/assets/index-AAA.js")
	css := tagOf("/assets/index-AAA.css")
	if js == "" || css == "" {
		t.Fatal("a file came back without a tag")
	}
	if js == css {
		t.Errorf("two different files share the tag %s", js)
	}
}

// A browser holding a stale index.html asks for a bundle that no longer
// exists; handed HTML instead, it silently keeps showing the old interface.
func TestAMissingBundleIsNotThePage(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, UI: uiFS()})

	resp, err := srv.Client().Get(srv.URL + "/assets/index-FROM-AN-OLDER-BUILD.js")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("a bundle from an older build answered %s rather than saying it is gone", resp.Status)
	}

	page, err := srv.Client().Get(srv.URL + "/some/deep/route")
	if err != nil {
		t.Fatal(err)
	}
	defer page.Body.Close()
	if page.StatusCode != http.StatusOK {
		t.Errorf("a reloaded sub-page answered %s", page.Status)
	}
}

// Opening a folder succeeds on an embedded tree, and a folder cannot seek, so
// the bare folder name has to be answered like any other route.
func TestTheAssetsFolderIsAnsweredLikeARoute(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, UI: uiFS()})

	resp, err := srv.Client().Get(srv.URL + "/assets")
	if err != nil {
		t.Fatalf("GET /assets dropped the connection: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("GET /assets answered %s rather than the page", resp.Status)
	}
	if got := resp.Header.Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Errorf("GET /assets came back as %q rather than the page", got)
	}
}

// Behind a reverse proxy, and when another app of the fortress opens this
// one, the interface lives under a path, and the page has to know which.
func TestThePageKnowsThePathItIsServedUnder(t *testing.T) {
	h := newHarness(t)
	ui := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte(`<!doctype html><html><head><base href="/" /><script src="./assets/index-AAA.js"></script></head></html>`)}}
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, UI: ui})

	page := func(path, prefix string) string {
		t.Helper()
		req, err := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		if prefix != "" {
			req.Header.Set("X-Forwarded-Prefix", prefix)
		}
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if !strings.Contains(resp.Header.Get("Vary"), "X-Forwarded-Prefix") {
			t.Errorf("%s under %q does not vary by the prefix", path, prefix)
		}
		return string(body)
	}
	cases := []struct{ path, prefix, base string }{
		{"/", "", `<base href="/">`},
		{"/jobs/Fotos", "", `<base href="/">`},
		{"/", "/fortress/open/0123abcd/", `<base href="/fortress/open/0123abcd/">`},
		{"/history", "/arrowloop", `<base href="/arrowloop/">`},
		{"/", `/"><script>alert(1)</script>/`, `<base href="/">`},
		{"/", "/a/../b/", `<base href="/">`},
		{"/", "//attacker.example/", `<base href="/">`},
		{"/", "https://attacker.example/", `<base href="/">`},
	}
	for _, c := range cases {
		body := page(c.path, c.prefix)
		if !strings.Contains(body, c.base) || strings.Count(body, "<base") != 1 {
			t.Errorf("%s under %q reads %s, want %s once", c.path, c.prefix, body, c.base)
		}
	}
}

// A page that names one prefix must not be answered from a cache to a
// request under another.
func TestThePageUnderAPrefixHasAValidatorOfItsOwn(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, UI: uiFS()})
	etag := func(prefix string) string {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/", nil)
		req.Header.Set("X-Forwarded-Prefix", prefix)
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.Header.Get("ETag")
	}
	if a, b := etag("/one/"), etag("/two/"); a == "" || a == b {
		t.Errorf("the pages under two prefixes carry the ETags %q and %q", a, b)
	}
}
