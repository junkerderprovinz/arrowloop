package remotes

// ProviderFor names the product behind a saved target, or returns "" when the
// settings do not pin one down.
//
// Many products share a backend, but each writes its Preset into the target,
// and backend plus preset is unique. A provider matches when it speaks the
// target's backend and every preset key holds in the target; the match with the
// most preset keys wins, so a MinIO target is MinIO rather than plain S3. A tie,
// which only a hand-edited file can produce, returns nothing.
func ProviderFor(r Remote) string {
	saved := make(map[string]string, len(r.Settings))
	for _, s := range r.Settings {
		// A secret arrives as a placeholder, and no preset carries one.
		if s.Secret {
			continue
		}
		saved[s.Key] = s.Value
	}

	best, bestKeys, tied := "", -1, false
	for _, p := range providers {
		if p.Backend != r.Type {
			continue
		}
		if !presetHolds(p.Preset, saved) {
			continue
		}
		switch {
		case len(p.Preset) > bestKeys:
			best, bestKeys, tied = p.ID, len(p.Preset), false
		case len(p.Preset) == bestKeys:
			tied = true
		}
	}
	if tied {
		return ""
	}
	return best
}

// presetHolds reports whether every key a provider presets is present in the
// saved target with that value.
func presetHolds(preset, saved map[string]string) bool {
	for key, want := range preset {
		if got, ok := saved[key]; !ok || got != want {
			return false
		}
	}
	return true
}

// MarkFor is the logo for a saved target, or empty where the product has none.
func MarkFor(r Remote) string {
	id := ProviderFor(r)
	if id == "" {
		return ""
	}
	for _, p := range providers {
		if p.ID == id {
			return p.Mark
		}
	}
	return ""
}
