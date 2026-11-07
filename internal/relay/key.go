package relay

// The secret behind a pairing phrase and the key that groups instances on a
// relay are different values. The relay key travels in the clear in every
// hello frame, so it is derived from the secret with a hash: a relay learns
// an identifier for the group and never the secret that would reproduce its
// phrase. Proxy frames are sealed with a second key derived from the same
// secret under its own domain (see seal.go).
//
// The domains are ArrowLoop's own, as BombVault and KnightLoader have theirs,
// so the same twelve words typed into two different apps never put them in
// one group on the shared relay.

import (
	"crypto/sha256"
	"encoding/hex"
)

// DefaultRelayURL is the relay every instance dials unless its owner points it
// elsewhere: ParleyPort, which the project runs for BombVault and KnightLoader
// as well. Because the address is compiled in, a phrase only has to carry the
// secret.
const DefaultRelayURL = "wss://parleyport.halleluja.design/relay/connect"

// PairingCode is the text of the QR code shown beside a phrase. On the project
// relay it is the phrase alone; an instance on a relay of its own names that
// relay on a second line, so the device that reads the code dials the same
// one.
func PairingCode(phrase, relayURL string) string {
	dial, err := connectURL(relayURL)
	if err != nil || dial == DefaultRelayURL {
		return phrase
	}
	return phrase + "\n" + dial
}

// keyDomain keeps this hash of the secret distinct from any other key derived
// from it, so two features never end up sharing one credential.
const keyDomain = "arrowloop/relay/group-key/v1"

// DeriveKey returns the relay key for a secret, the value an instance puts in
// its hello frame. It is hex so it survives logs, URLs and config files.
func DeriveKey(secret []byte) string {
	h := sha256.New()
	h.Write([]byte(keyDomain))
	h.Write(secret)
	return hex.EncodeToString(h.Sum(nil))
}

// frameDomain separates the frame key from the relay key. The relay receives
// DeriveKey's output in every hello, so a frame key derived from that value or
// the same domain would be one the relay already holds.
const frameDomain = "arrowloop/relay/frame-key/v1"

// DeriveFrameKey returns the AES-256-GCM key that seals proxy frames between
// instances sharing a pairing phrase. It is derived on both ends and never
// stored or sent, so a relay operator holding the group key cannot compute it.
func DeriveFrameKey(secret []byte) []byte {
	h := sha256.New()
	h.Write([]byte(frameDomain))
	h.Write(secret)
	return h.Sum(nil)
}
