package remotes

// Naming the PRODUCT behind a saved target.
//
// A target records the rclone BACKEND it speaks and nothing about which product
// created it, and that is not enough to put a logo on it. Sixteen products share
// `s3` and four share `webdav`, so a screen that picked the first provider with
// a matching backend would put MinIO's logo on somebody's Wasabi and Nextcloud's
// on somebody's ownCloud. The standing rule here is that a mark naming the WRONG
// service is worse than no mark, so the honest answer used to be to draw none -
// which cost every object store and the whole Nextcloud family their logo.
//
// The information was there the whole time. Every provider writes a Preset into
// the target when it is created: `provider = Minio`, `provider = Wasabi`,
// `vendor = nextcloud`. Backend plus preset is unique across all of them, so
// reading the saved settings back names the product EXACTLY rather than
// narrowing it down. No guessing is involved and no rule has to be relaxed.
//
// This lives in the engine rather than in either interface because the question
// is about the engine's own data, and because two answers to one question is how
// the app and the container end up disagreeing about what a target is.

// ProviderFor names the product behind a saved target, or returns an empty
// string when the settings do not pin one down.
//
// A provider matches when it speaks the target's backend AND every key in its
// preset is present in the target with that exact value. The MOST SPECIFIC match
// wins: a MinIO target carries `provider = Minio`, which matches both the MinIO
// provider (one preset key) and the plain S3 provider (no preset keys at all),
// and the one that named something is the one that knows something.
//
// A tie returns nothing. Two providers of the same backend always differ in
// their presets, so a tie needs a target carrying both of two disjoint presets,
// which nothing in this program creates - but a hand-edited configuration file
// can, and "I cannot tell" is the only answer that is never wrong.
func ProviderFor(r Remote) string {
	saved := make(map[string]string, len(r.Settings))
	for _, s := range r.Settings {
		// A secret is reported as a placeholder rather than its value, so it can
		// never be compared. No preset carries a secret - a preset is what gets
		// filled in WITHOUT asking, and nothing unasked is a credential.
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
//
// The two steps are separate on purpose: ProviderFor answers a question about
// identity that other things will want too, and only this one is about drawing.
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
