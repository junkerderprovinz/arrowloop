package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

// sealedPrefix marks a value Seal wrote. A value without it was written by a
// build that stored it in clear, and is sealed on the next write.
const sealedPrefix = "sealed:"

// ErrWrongKey is returned when a sealed value does not open with the key in
// force: the file was written under another one.
var ErrWrongKey = errors.New("it was sealed with another key")

// Seal encrypts plain with AES-256-GCM under a key derived from the install's.
func Seal(key []byte, plain string) (string, error) {
	aead, err := sealer(key)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	box := aead.Seal(nonce, nonce, []byte(plain), nil)
	return sealedPrefix + base64.RawStdEncoding.EncodeToString(box), nil
}

// Unseal opens what Seal wrote. A value without the prefix is returned as it
// is.
func Unseal(key []byte, value string) (string, error) {
	if !strings.HasPrefix(value, sealedPrefix) {
		return value, nil
	}
	box, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(value, sealedPrefix))
	if err != nil {
		return "", ErrWrongKey
	}
	aead, err := sealer(key)
	if err != nil {
		return "", err
	}
	if len(box) < aead.NonceSize() {
		return "", ErrWrongKey
	}
	plain, err := aead.Open(nil, box[:aead.NonceSize()], box[aead.NonceSize():], nil)
	if err != nil {
		return "", ErrWrongKey
	}
	return string(plain), nil
}

// sealer derives the sealing key from the install's, so the same key never
// serves as both the password pepper and the cipher key.
func sealer(key []byte) (cipher.AEAD, error) {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("arrowloop:seal"))
	block, err := aes.NewCipher(mac.Sum(nil))
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
