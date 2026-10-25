package remotes

import "testing"

// A server that does not list its shares refuses the top of the target, so
// the test opens the share the form names.
func TestAnSMBTestOpensTheShareItNames(t *testing.T) {
	settings := map[string]string{"host": "nas", "share": "/fotos/"}
	got := connectionString("smb", settings) + checkedFolder("smb", func(key string) string { return settings[key] })
	if got != ":smb,host=nas:fotos" {
		t.Fatalf("the test opens %q, want the share fotos", got)
	}
}

func TestTheShareIsAskedForWithTheServer(t *testing.T) {
	for _, b := range Backends() {
		if b.Name != "smb" {
			continue
		}
		for _, o := range b.Options {
			if o.Name == shareKey && o.Essential && !o.Secret {
				return
			}
		}
	}
	t.Fatal("the smb form does not ask for a share")
}
