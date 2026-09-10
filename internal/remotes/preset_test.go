package remotes

import (
	"testing"

	_ "github.com/rclone/rclone/backend/all"
)

// TestEveryPresetNamesSomethingTheBackendKnows.
//
// A preset is a value written into a target without anybody being asked, and a
// wrong one is the quietest kind of wrong there is. rclone does not refuse an
// unknown `provider`: it accepts it, falls back to plain S3, and gets on with
// the job - which works for most of the fifty-three and silently drops whatever
// the named one does differently. `vendor` on webdav behaves the same way, and
// that field is the entire difference between a Nextcloud target that connects
// and one that also works properly.
//
// Nothing anywhere else would notice. The target saves, the check passes, the
// first run copies files. So this asks rclone what it actually offers and
// compares, which is the only place the answer exists.
func TestEveryPresetNamesSomethingTheBackendKnows(t *testing.T) {
	byName := map[string]Backend{}
	for _, b := range Backends() {
		byName[b.Name] = b
	}

	// Only the options whose value is a CLOSED set. A preset for a free-text
	// option - an endpoint, a region - has nothing to be checked against, and
	// demanding one would make this test refuse correct entries.
	closed := map[string]bool{"provider": true, "vendor": true}

	for _, p := range providers {
		b, ok := byName[p.Backend]
		if !ok {
			// A provider for a backend this build does not carry is filtered
			// out of Providers() already; it is not this test's business.
			continue
		}
		for key, value := range p.Preset {
			if !closed[key] {
				continue
			}
			var option *Option
			for i := range b.Options {
				if b.Options[i].Name == key {
					option = &b.Options[i]
					break
				}
			}
			if option == nil {
				t.Errorf("%s presets %s=%q, but %s has no such option", p.ID, key, value, p.Backend)
				continue
			}
			if len(option.Examples) == 0 {
				// The option exists but offers no closed set here. Nothing to
				// compare against, and saying so beats inventing a rule.
				continue
			}
			known := false
			for _, e := range option.Examples {
				if e.Value == value {
					known = true
					break
				}
			}
			if !known {
				offered := make([]string, 0, len(option.Examples))
				for _, e := range option.Examples {
					offered = append(offered, e.Value)
				}
				t.Errorf("%s presets %s=%q, which %s does not offer. It knows: %v",
					p.ID, key, value, p.Backend, offered)
			}
		}
	}
}
