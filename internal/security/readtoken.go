package security

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

// ReadToken is a token the version before the sign-in package made for a
// dashboard that reads the fortress status and log. The sign-in takes them
// over as API tokens that may read, by the digest kept here.
type ReadToken struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Hash      string `json:"hash"`
	CreatedAt int64  `json:"createdAt"`
}

// readTokenPrefix starts every read token.
const readTokenPrefix = "alr_"

// ReadTokenDigest is the HMAC under the install's key that security.json
// kept of a read token.
func ReadTokenDigest(key []byte, plain string) string {
	domain := hmac.New(sha256.New, key)
	domain.Write([]byte("arrowloop/read-token/v1"))
	mac := hmac.New(sha256.New, domain.Sum(nil))
	mac.Write([]byte(plain))
	return hex.EncodeToString(mac.Sum(nil))
}
