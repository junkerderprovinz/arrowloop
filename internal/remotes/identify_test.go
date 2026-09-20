package remotes

import "testing"

// A MinIO target names MinIO, not the plain S3 provider that also matches.
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

// Having the preset's key with another value is not a match.
func TestAPresetMustMatchTheValue(t *testing.T) {
	r := Remote{Type: "s3", Settings: []Setting{{Key: "provider", Value: "Wasabi"}}}
	if got := ProviderFor(r); got != "wasabi" {
		t.Fatalf("provider = %q, want wasabi", got)
	}
}

func TestAnUnknownBackendNamesNothing(t *testing.T) {
	r := Remote{Type: "not-a-backend", Settings: []Setting{}}
	if got := ProviderFor(r); got != "" {
		t.Fatalf("provider = %q, want empty", got)
	}
}

// ProviderFor relies on this: a duplicate would make every target of both
// products lose its logo.
func TestBackendAndPresetAreUniqueAcrossProviders(t *testing.T) {
	seen := map[string]string{}
	for _, p := range providers {
		key := p.Backend + "\x00"
		for _, k := range sortedKeys(p.Preset) {
			key += k + "=" + p.Preset[k] + ";"
		}
		if other, clash := seen[key]; clash {
			t.Errorf("%q and %q are indistinguishable: same backend %q and same preset", other, p.ID, p.Backend)
		}
		seen[key] = p.ID
	}
}

// Builds the target each provider would create and asks for its logo back.
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
