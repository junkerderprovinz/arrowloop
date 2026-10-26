package job

import (
	"strings"
	"testing"
)

// The top of an SMB server is the list of its shares, where a run can write
// nothing at all.
func TestASideAtTheShareListIsRefused(t *testing.T) {
	targets(t, "nas: type=smb host=nas.example user=reeve")
	for _, c := range []struct {
		side    string
		refused bool
	}{
		{"nas:", true},
		{"nas:/", true},
		{"nas:fotos", false},
		{"nas:fotos/2026", false},
	} {
		err := loadWithSides(t, "/fotos", c.side)
		refused := err != nil && strings.Contains(err.Error(), "only lists the server's shares")
		if refused != c.refused {
			t.Errorf("%s refused=%v, want %v (err: %v)", c.side, refused, c.refused, err)
		}
	}
}
