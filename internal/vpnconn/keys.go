package vpnconn

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/vpn"
)

// What a provider that registers a key of ArrowLoop's own keeps beside the
// login, so the next connection takes up the same key instead of filling the
// account with new ones.
const (
	// ownerField says whose account the rest belongs to, as a hash.
	ownerField  = "owner"
	keyField    = "deviceKey"
	deviceField = "deviceId"
	// tokenField is the API token, for a provider whose tokens last.
	tokenField = "apiToken"
	// placeField is the location a key was registered for, for a provider
	// that ties a key to one.
	placeField = "devicePlace"
)

// owned is login with the state of another account dropped: a key
// registered for an account belongs to that account alone.
func owned(login Login, account string) Login {
	sum := sha256.Sum256([]byte(account))
	who := hex.EncodeToString(sum[:16])
	next := Login{}
	for k, v := range login {
		next[k] = v
	}
	if next[ownerField] != who {
		for _, k := range []string{keyField, deviceField, tokenField, placeField} {
			delete(next, k)
		}
		next[ownerField] = who
	}
	return next
}

// storedKey is the private key kept with the login, if any.
func storedKey(login Login) (vpn.Key, bool) {
	k, err := vpn.ParseKey(login[keyField])
	return k, err == nil && !k.IsZero()
}

// accountNumber drops the spaces and dashes an account number is often
// written with.
func accountNumber(s string) string {
	return strings.Map(func(r rune) rune {
		if r == ' ' || r == '-' {
			return -1
		}
		return r
	}, s)
}
