package remotes

import (
	"testing"

	_ "github.com/rclone/rclone/backend/all"
)

// rclone silently treats an unknown provider as plain S3 and an unknown webdav
// vendor as generic WebDAV, so nothing else would notice a misspelled preset.
func TestEveryPresetNamesSomethingTheBackendKnows(t *testing.T) {
	byName := map[string]Backend{}
	for _, b := range Backends() {
		byName[b.Name] = b
	}

	// Only options with a closed set of values can be checked.
	closed := map[string]bool{"provider": true, "vendor": true}

	for _, p := range providers {
		b, ok := byName[p.Backend]
		if !ok {
			// Providers() already filters these out.
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
