package security

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// A copy of security.json alone must not be enough to test guesses against.
func TestAPasswordHashNeedsTheKey(t *testing.T) {
	hash, err := HashPassword(testKey, "a long enough passphrase")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "argon2id$") {
		t.Fatalf("the hash is not Argon2id: %s", hash)
	}
	if !VerifyPassword(testKey, "a long enough passphrase", hash) {
		t.Fatal("the hash does not verify its own password")
	}
	if VerifyPassword([]byte("another key, thirty-two bytes.."), "a long enough passphrase", hash) {
		t.Error("the hash verifies under another key")
	}
	if VerifyPassword(testKey, "a different passphrase", hash) {
		t.Error("the hash verifies a password it was not made from")
	}
	if NeedsRehash(hash) {
		t.Error("a fresh hash asks to be made again")
	}
}

func TestAnOlderBcryptHashStillVerifiesAndAsksToBeMadeAgain(t *testing.T) {
	old, err := bcrypt.GenerateFromPassword([]byte("old passphrase"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(testKey, "old passphrase", string(old)) {
		t.Fatal("an older bcrypt hash no longer verifies")
	}
	if !NeedsRehash(string(old)) {
		t.Error("a bcrypt hash is not marked for a new hash")
	}
}

func TestADamagedHashRefusesEveryPassword(t *testing.T) {
	for _, bad := range []string{"", "argon2id$", "argon2id$x$2$1$c2FsdA$a2V5", "argon2id$0$2$1$c2FsdA$a2V5", "plain text"} {
		if VerifyPassword(testKey, "", bad) || VerifyPassword(testKey, "plain text", bad) {
			t.Errorf("%q accepted a password", bad)
		}
	}
}
