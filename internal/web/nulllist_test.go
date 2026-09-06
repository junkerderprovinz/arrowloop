package web_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

// No list this API answers with may ever arrive as `null`.
//
// A nil slice in Go marshals to `null`, not to `[]`, and every consumer of this
// API treats a list as a list: the first `.filter` or `.map` on a null takes the
// whole page down with a blank screen and one line in a console nobody has
// open. That is not a hypothetical. A storage target saved with nothing but its
// type, which is exactly what the create form produces before a single field is
// filled in, came back with `"settings": null` and blanked the interface the
// moment the row tried to draw itself.
//
// The trap is that the nil case is the EMPTY case, so it appears on a fresh
// installation and never once during development on a machine that already has
// data. That is why this is a test over the responses rather than a note asking
// people to remember: remembering is what failed.

// nullLists finds every `"key": null` in a JSON document, so the failure names
// the field rather than only the endpoint.
var nullLists = regexp.MustCompile(`"([A-Za-z]+)"\s*:\s*null`)

// Fields that are genuinely allowed to be null, because null is a real answer
// there rather than an empty collection: a job that has never worked has no
// last success, and saying so with null is clearer than with a fake date.
var nullable = map[string]bool{
	"lastSuccess": true,
	"left":        true,
	"right":       true,
	"run":         true,
}

func TestNoEndpointAnswersWithANullList(t *testing.T) {
	h := newHarness(t)

	// A storage target with a type and NOTHING else, which is what the create
	// form produces before a single field is filled in, and the only state in
	// which the settings list is empty.
	//
	// Without this the sweep below runs against a machine that has no targets
	// at all, so the empty list never appears, so `null` never appears, so the
	// test passes with the bug present. Checked that way round rather than
	// assumed: with the fix reverted and no target configured, this test was
	// green.
	withRcloneConfig(t)
	if err := remotes.Save("bare", "s3", map[string]string{}); err != nil {
		t.Fatalf("save a bare target: %v", err)
	}

	for _, path := range []string{
		"/api/jobs",
		"/api/history?limit=10",
		"/api/config",
		"/api/remotes",
		"/api/volumes",
		"/api/volumes/candidates",
		"/api/browse",
	} {
		t.Run(path, func(t *testing.T) {
			res, err := http.Get(h.srv.URL + path)
			if err != nil {
				t.Fatalf("get: %v", err)
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				t.Fatalf("want 200, got %d", res.StatusCode)
			}
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			// Parsed first, so a body that is not JSON at all fails here with a
			// clear message rather than silently passing the regular expression.
			var any any
			if err := json.Unmarshal(body, &any); err != nil {
				t.Fatalf("not JSON: %v", err)
			}
			// A bare `null` document is the same fault one level up.
			if bytes.Equal(bytes.TrimSpace(body), []byte("null")) {
				t.Fatal("the whole response is null rather than an empty list")
			}

			for _, m := range nullLists.FindAllSubmatch(body, -1) {
				field := string(m[1])
				if nullable[field] {
					continue
				}
				t.Errorf("%q came back as null; an empty list has to be []", field)
			}
		})
	}
}
