package web_test

import (
	"net/http"
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

// TestTheInterfaceCarriesAValidator.
//
// An embedded file has no modification time, so net/http sends no
// Last-Modified. Without an ETag the browser has NO validator at all and may
// keep the bundle it has for as long as it likes. The symptom is not an error
// anybody can see from outside: it is one person looking at a new build and
// seeing the old interface, while the server is answering perfectly.
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

// TestTheTwoCacheRulesPullApartOnPurpose.
//
// index.html must be revalidated on every load, because it names the others.
// A content-hashed bundle may be kept without asking, because a changed file
// arrives under a different name and this copy can never become wrong. Getting
// these the same way round is what makes an update invisible.
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

// TestAValidatorActuallySavesTheTransfer.
//
// The header is only half of it: a conditional request has to come back 304
// with no body, or "revalidate every time" costs a full download every time.
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

// TestTwoDifferentFilesGetTwoDifferentTags.
//
// One tag for everything would validate as "unchanged" across a real change,
// which is worse than no tag: the browser would then be entitled to keep the
// old copy AND be told it was right to.
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

// TestAMissingBundleIsNotThePage.
//
// The SPA fallback exists so a reload of a sub-page reaches the interface's own
// router. Applying it under assets/ turns "this bundle is gone" into "here is
// some HTML, with a 200", and a browser holding a stale index.html then asks
// for a bundle that no longer exists and is handed a web page where it expected
// a script. It fails silently and goes on showing what it had, which is exactly
// what "das UI ist völlig unverändert" looks like from the inside.
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

	// And the fallback still works for everything that is not an asset, which is
	// the whole reason it exists.
	page, err := srv.Client().Get(srv.URL + "/some/deep/route")
	if err != nil {
		t.Fatal(err)
	}
	defer page.Body.Close()
	if page.StatusCode != http.StatusOK {
		t.Errorf("a reloaded sub-page answered %s", page.Status)
	}
}
