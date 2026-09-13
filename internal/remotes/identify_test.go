package remotes

import "testing"

// A MinIO target names MinIO, not the plain S3 provider that also matches.
//
// This is the whole point of the exercise: sixteen products speak `s3`, and
// before this the honest answer for every one of them was "I cannot tell".
func TestTheMostSpecificPresetWins(t *testing.T) {
	r := Remote{Type: "s3", Settings: []Setting{
		{Key: "provider", Value: "Minio"},
		{Key: "endpoint", Value: "http://192.168.20.49:3900"},
	}}
	if got := ProviderFor(r); got != "minio" {
		t.Fatalf("provider = %q, want minio", got)
	}
	if got := MarkFor(r); got != "IconMinio" {
		t.Fatalf("mark = %q, want IconMinio", got)
	}
}

// The four WebDAV clouds are told apart by their vendor, which is exactly the
// pair the old rule refused to answer for.
func TestTheWebdavCloudsAreToldApart(t *testing.T) {
	for vendor, want := range map[string]string{
		"nextcloud": "nextcloud",
		"owncloud":  "owncloud",
	} {
		r := Remote{Type: "webdav", Settings: []Setting{{Key: "vendor", Value: vendor}}}
		if got := ProviderFor(r); got != want {
			t.Errorf("vendor %q -> %q, want %q", vendor, got, want)
		}
	}
}

// A bare S3 target with no provider key is Amazon's own, which is what rclone
// itself means by an s3 remote without a provider.
func TestABareBackendFallsToTheGenericProvider(t *testing.T) {
	r := Remote{Type: "s3", Settings: []Setting{{Key: "region", Value: "eu-central-1"}}}
	if got := ProviderFor(r); got != "s3" {
		t.Fatalf("provider = %q, want s3", got)
	}
}

// A preset whose value does not match must not count as a match. Without this,
// `provider = Wasabi` would satisfy MinIO's preset by having the key at all.
func TestAPresetMustMatchTheVALUE(t *testing.T) {
	r := Remote{Type: "s3", Settings: []Setting{{Key: "provider", Value: "Wasabi"}}}
	if got := ProviderFor(r); got != "wasabi" {
		t.Fatalf("provider = %q, want wasabi", got)
	}
}

// Nothing at all for a backend no provider claims, rather than a wrong guess.
func TestAnUnknownBackendNamesNothing(t *testing.T) {
	r := Remote{Type: "not-a-backend", Settings: []Setting{}}
	if got := ProviderFor(r); got != "" {
		t.Fatalf("provider = %q, want empty", got)
	}
}

// THE PROPERTY THE WHOLE DESIGN RESTS ON, asserted rather than assumed: backend
// plus preset is unique across every provider. The moment somebody adds a
// seventeenth S3 product with a preset that already exists, resolution becomes
// a coin toss and every target of both products silently loses its logo. A test
// that fails at the moment the duplicate is WRITTEN is the only warning anybody
// gets, because nothing else about it looks wrong.
func TestBackendAndPresetAreUniqueAcrossProviders(t *testing.T) {
	seen := map[string]string{}
	for _, p := range providers {
		key := p.Backend + "\x00"
		// Sorted by construction: a map has no order, so the key is built from
		// the pairs in a fixed order to compare two providers fairly.
		for _, k := range sortedKeys(p.Preset) {
			key += k + "=" + p.Preset[k] + ";"
		}
		if other, clash := seen[key]; clash {
			t.Errorf("%q and %q are indistinguishable: same backend %q and same preset", other, p.ID, p.Backend)
		}
		seen[key] = p.ID
	}
}

// Every provider that carries a logo must be REACHABLE through a saved target,
// otherwise the logo is decoration in a table nobody can get to. Built by
// creating the target each provider would create and asking for it back.
func TestEveryMarkedProviderCanBeFoundFromItsOwnTarget(t *testing.T) {
	for _, p := range providers {
		if p.Mark == "" {
			continue
		}
		r := Remote{Type: p.Backend, Settings: []Setting{}}
		for _, k := range sortedKeys(p.Preset) {
			r.Settings = append(r.Settings, Setting{Key: k, Value: p.Preset[k]})
		}
		if got := MarkFor(r); got != p.Mark {
			t.Errorf("%s: mark = %q, want %q", p.ID, got, p.Mark)
		}
	}
}

func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j] < out[j-1]; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}
