package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The Flatpak builds offline from flatpak/go-sources.json and node-sources.json,
// so a dependency bumped without node flatpak/update-sources.mjs only fails once
// a release builds the Flatpak. These tests catch it on the commit that bumps it.

func flatpakURLs(t *testing.T, name string) map[string]bool {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "flatpak", name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	var sources []struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(raw, &sources); err != nil {
		t.Fatalf("parse %s: %v", name, err)
	}
	urls := make(map[string]bool, len(sources))
	for _, s := range sources {
		urls[s.URL] = true
	}
	return urls
}

// escapeModule spells a module path as the module proxy does, with every
// upper-case letter as an exclamation mark and its lower-case form.
func escapeModule(path string) string {
	var b strings.Builder
	for _, r := range path {
		if r >= 'A' && r <= 'Z' {
			b.WriteByte('!')
			r += 'a' - 'A'
		}
		b.WriteRune(r)
	}
	return b.String()
}

var (
	requireLine = regexp.MustCompile(`^(?:require\s+)?([^\s()]+)\s+(v[^\s]+)(?:\s+// indirect)?$`)
	proxyFile   = regexp.MustCompile(`^https://proxy\.golang\.org/(.+)/@v/([^/]+)\.(?:mod|zip|info)$`)
)

// A module only Windows or macOS needs never reaches the Linux build, so only a
// module the sources hold at another version than go.mod asks for is stale.
func TestEveryModuleTheFlatpakFetchesIsAtTheVersionTheDesktopRequires(t *testing.T) {
	raw, err := os.ReadFile("go.mod")
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}
	held := map[string]map[string]bool{}
	for url := range flatpakURLs(t, "go-sources.json") {
		if m := proxyFile.FindStringSubmatch(url); m != nil {
			if held[m[1]] == nil {
				held[m[1]] = map[string]bool{}
			}
			held[m[1]][m[2]] = true
		}
	}
	inRequire := false
	for line := range strings.Lines(string(raw)) {
		line = strings.TrimSpace(line)
		switch {
		case line == "require (":
			inRequire = true
			continue
		case line == ")":
			inRequire = false
			continue
		case !inRequire && !strings.HasPrefix(line, "require "):
			continue
		}
		m := requireLine.FindStringSubmatch(line)
		if m == nil || m[1] == "github.com/junkerderprovinz/arrowloop" {
			continue
		}
		versions := held[escapeModule(m[1])]
		if versions != nil && !versions[m[2]] {
			t.Errorf("flatpak/go-sources.json holds %s at another version than %s; run node flatpak/update-sources.mjs", m[1], m[2])
		}
	}
}

func TestEveryPackageTheWebLocksIsInTheFlatpakSources(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "web", "package-lock.json"))
	if err != nil {
		t.Fatalf("read package-lock.json: %v", err)
	}
	var lock struct {
		Packages map[string]struct {
			Resolved string `json:"resolved"`
		} `json:"packages"`
	}
	if err := json.Unmarshal(raw, &lock); err != nil {
		t.Fatalf("parse package-lock.json: %v", err)
	}
	urls := flatpakURLs(t, "node-sources.json")
	for name, p := range lock.Packages {
		// A tarball in the repository travels with the source the Flatpak builds from.
		if strings.HasPrefix(p.Resolved, "file:") {
			continue
		}
		if p.Resolved != "" && !urls[p.Resolved] {
			t.Errorf("%s (%s) is not in flatpak/node-sources.json; run node flatpak/update-sources.mjs", name, p.Resolved)
		}
	}
}
