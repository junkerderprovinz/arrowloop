package security_test

import (
	"slices"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/pairing"
	"github.com/junkerderprovinz/arrowloop/internal/security"
	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
)

// An unfinished key file is replaced only while none of these exists, so a
// renamed store has to be renamed in the list too.
func TestEveryStoreSealedWithTheKeyKeepsAnUnfinishedKeyFile(t *testing.T) {
	for _, name := range []string{security.FileName, security.SignInFileName, pairing.FileName, vpnconn.FileName} {
		if !slices.Contains(security.KeyedFiles, name) {
			t.Errorf("%s is sealed with the key but missing from the list", name)
		}
	}
}
