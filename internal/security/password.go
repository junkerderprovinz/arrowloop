package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

// A password is stored as Argon2id over an HMAC of it keyed with the install's
// key. Argon2id makes every guess cost memory and time; the HMAC makes a copy
// of security.json worthless without the key.
//
// m=19 MiB, t=2, p=1 is OWASP's first Argon2id profile. More memory buys
// little here: the engine also runs on phones, and the login throttle already
// bounds how often this runs.
const (
	argonMemoryKiB = 19 * 1024
	argonTime      = 2
	argonThreads   = 1
	argonKeyLen    = 32
	argonSaltLen   = 16

	argonPrefix = "argon2id$"
)

// HashPassword returns the stored form of a password under key. The string
// carries its parameters and salt, so a hash written today still verifies
// after the parameters change.
func HashPassword(key []byte, plain string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("draw a salt: %w", err)
	}
	sum := argon2.IDKey(pepper(key, plain), salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	return fmt.Sprintf("%s%d$%d$%d$%s$%s", argonPrefix, argonMemoryKiB, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(sum)), nil
}

// VerifyPassword reports whether plain matches stored. A bcrypt hash, as
// older builds and many generators write, is checked as bcrypt.
func VerifyPassword(key []byte, plain, stored string) bool {
	if strings.HasPrefix(stored, "$2") {
		return bcrypt.CompareHashAndPassword([]byte(stored), []byte(plain)) == nil
	}
	m, t, p, salt, want, ok := parseArgon(stored)
	if !ok {
		return false
	}
	got := argon2.IDKey(pepper(key, plain), salt, t, m, p, uint32(len(want)))
	return hmac.Equal(got, want)
}

// NeedsRehash reports whether a stored hash is in an older form, so a right
// password should be stored again.
func NeedsRehash(stored string) bool {
	return !strings.HasPrefix(stored, argonPrefix)
}

func pepper(key []byte, plain string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("arrowloop:password:" + plain))
	return mac.Sum(nil)
}

// parseArgon refuses anything malformed rather than guessing at defaults: a
// damaged hash must refuse every password, not accept one hashed today.
func parseArgon(s string) (m, t uint32, p uint8, salt, key []byte, ok bool) {
	if !strings.HasPrefix(s, argonPrefix) {
		return 0, 0, 0, nil, nil, false
	}
	parts := strings.Split(strings.TrimPrefix(s, argonPrefix), "$")
	if len(parts) != 5 {
		return 0, 0, 0, nil, nil, false
	}
	mv, err1 := strconv.ParseUint(parts[0], 10, 32)
	tv, err2 := strconv.ParseUint(parts[1], 10, 32)
	pv, err3 := strconv.ParseUint(parts[2], 10, 8)
	salt, err4 := base64.RawStdEncoding.DecodeString(parts[3])
	key, err5 := base64.RawStdEncoding.DecodeString(parts[4])
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil ||
		mv == 0 || tv == 0 || pv == 0 || len(salt) == 0 || len(key) == 0 || len(key) > 64 {
		return 0, 0, 0, nil, nil, false
	}
	return uint32(mv), uint32(tv), uint8(pv), salt, key, true
}
