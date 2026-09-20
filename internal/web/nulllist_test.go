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

// A nil slice marshals to null, and the first .map over a null blanks the
// interface. It only happens in the empty case, as on a fresh install, so this
// sweeps the responses rather than relying on anybody remembering.

// nullLists finds every `"key": null` in a JSON document, so the failure names
// the field rather than only the endpoint.
var nullLists = regexp.MustCompile(`"([A-Za-z]+)"\s*:\s*null`)

// nullable lists the fields where null is a real answer rather than an empty
// collection, such as the last success of a job that has never worked.
var nullable = map[string]bool{
	"lastSuccess": true,
	"left":        true,
	"right":       true,
	"run":         true,
}

func TestNoEndpointAnswersWithANullList(t *testing.T) {
	h := newHarness(t)

	// A target with nothing but a type, as the create form saves it, is the
	// only state with an empty settings list. Without it the sweep would pass
	// with the bug present.
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
			// Parsed first, so a body that is not JSON cannot pass the regular
			// expression.
			var any any
			if err := json.Unmarshal(body, &any); err != nil {
				t.Fatalf("not JSON: %v", err)
			}
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
