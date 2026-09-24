package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"
)

// TOTP (RFC 6238) is the second login factor. The algorithm is a few dozen
// lines, so the login path takes no dependency for it.
//
// SHA-1 is what the RFC specifies and what authenticator apps implement. It
// runs inside HMAC, where its collision weakness does not apply, and a secret
// set up with SHA-256 could not be enrolled in Google Authenticator.

const (
	totpDigits = 6
	totpPeriod = 30 * time.Second

	// totpSkew is how many steps either side of now are accepted: enough for a
	// phone clock a few seconds off and a code typed as it rolls over. A wider
	// window gives an attacker time and the owner nothing.
	totpSkew = 1

	// totpSecretLen is the length RFC 4226 recommends and apps expect.
	totpSecretLen = 20
)

var totpEnc = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewTOTPSecret returns a fresh base32 secret for an authenticator app.
func NewTOTPSecret() (string, error) {
	buf := make([]byte, totpSecretLen)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", fmt.Errorf("draw a totp secret: %w", err)
	}
	return totpEnc.EncodeToString(buf), nil
}

// TOTPCode returns the six-digit code for secret at time t.
func TOTPCode(secret string, t time.Time) (string, error) {
	key, err := totpEnc.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", fmt.Errorf("the totp secret is not base32: %w", err)
	}
	return totpAt(key, totpStep(t)), nil
}

// totpStep turns a time into an RFC 6238 counter. A time before 1970 clamps to
// step 0, since the negative number would wrap to a counter no app reaches,
// and a box whose clock was never set is exactly where that happens.
func totpStep(t time.Time) uint64 {
	sec := t.Unix()
	if sec < 0 {
		return 0
	}
	return uint64(sec) / uint64(totpPeriod.Seconds())
}

func totpAt(key []byte, counter uint64) string {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)

	// Dynamic truncation (RFC 4226 5.3): the low nibble of the last byte picks
	// a four-byte window, whose top bit is masked so the value is positive.
	offset := sum[len(sum)-1] & 0x0f
	code := (uint32(sum[offset])&0x7f)<<24 |
		uint32(sum[offset+1])<<16 |
		uint32(sum[offset+2])<<8 |
		uint32(sum[offset+3])

	mod := uint32(1)
	for range totpDigits {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", totpDigits, code%mod)
}

// MatchTOTP reports whether code is valid for secret around time t, one step
// of clock skew either side, and which step it belongs to, so the caller can
// refuse a step it has already accepted.
//
// Every window is compared in constant time. A timing leak on the leading
// digits would let an attacker find each digit on its own, turning a million
// guesses into sixty.
func MatchTOTP(secret, code string, t time.Time) (uint64, bool) {
	// Some apps and some people put a space in the middle.
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(code) != totpDigits {
		return 0, false
	}
	key, err := totpEnc.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil || len(key) == 0 {
		return 0, false
	}
	now := totpStep(t)
	var matched uint64
	ok := false
	for d := -totpSkew; d <= totpSkew; d++ {
		step := now
		switch {
		case d < 0:
			if step < uint64(-d) {
				continue
			}
			step -= uint64(-d)
		case d > 0:
			step += uint64(d)
		}
		if subtle.ConstantTimeCompare([]byte(totpAt(key, step)), []byte(code)) == 1 {
			matched, ok = step, true
		}
	}
	return matched, ok
}

// ValidTOTP is MatchTOTP without the step.
func ValidTOTP(secret, code string, t time.Time) bool {
	_, ok := MatchTOTP(secret, code, t)
	return ok
}

// TOTPURI builds the otpauth:// address an authenticator app scans. The issuer
// goes into the label and into a parameter, because apps disagree about which
// one they read.
func TOTPURI(issuer, account, secret string) string {
	label := url.PathEscape(issuer + ":" + account)
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", fmt.Sprint(totpDigits))
	q.Set("period", fmt.Sprint(int(totpPeriod.Seconds())))
	return "otpauth://totp/" + label + "?" + q.Encode()
}

const (
	// recoveryCodeCount is enough to survive a lost phone and few enough that
	// people write them down.
	recoveryCodeCount = 8

	// recoveryHalfLen is the characters on each side of the dash.
	recoveryHalfLen = 5
)

// recoveryAlphabet leaves out what gets misread off a printed sheet: 0 and O,
// 1, l and I.
const recoveryAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"

// NewRecoveryCodes returns fresh single-use codes in plain text, shown to the
// owner once, and the hashes that are stored.
//
// A code carries about 50 bits drawn at random, so there is no dictionary for
// a slow hash to slow down, and a plain SHA-256 is enough.
func NewRecoveryCodes() (plain, hashed []string, err error) {
	plain = make([]string, 0, recoveryCodeCount)
	hashed = make([]string, 0, recoveryCodeCount)
	for range recoveryCodeCount {
		code, err := randomRecoveryCode()
		if err != nil {
			return nil, nil, err
		}
		plain = append(plain, code)
		hashed = append(hashed, HashRecoveryCode(code))
	}
	return plain, hashed, nil
}

func randomRecoveryCode() (string, error) {
	buf := make([]byte, recoveryHalfLen*2)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", fmt.Errorf("draw a recovery code: %w", err)
	}
	var b strings.Builder
	for i, v := range buf {
		if i == recoveryHalfLen {
			b.WriteByte('-')
		}
		// The modulo bias over 31 characters is under half a bit a character,
		// nothing next to the 50 bits a code carries.
		b.WriteByte(recoveryAlphabet[int(v)%len(recoveryAlphabet)])
	}
	return b.String(), nil
}

// HashRecoveryCode is the stored form of a recovery code. Case, spaces and
// the dash are dropped first, so "ABCDE FGHIJ" still gets in.
func HashRecoveryCode(code string) string {
	sum := sha256.Sum256([]byte("arrowloop:recovery:" + normalizeRecoveryCode(code)))
	return hex.EncodeToString(sum[:])
}

func normalizeRecoveryCode(code string) string {
	code = strings.ToLower(strings.TrimSpace(code))
	code = strings.ReplaceAll(code, "-", "")
	return strings.ReplaceAll(code, " ", "")
}

// MatchRecoveryCode returns the index of the stored hash code matches, or -1.
// Every entry is compared, so the time taken says neither which code was used
// nor how many are left.
func MatchRecoveryCode(code string, stored []string) int {
	if normalizeRecoveryCode(code) == "" {
		return -1
	}
	want := HashRecoveryCode(code)
	found := -1
	for i, h := range stored {
		if subtle.ConstantTimeCompare([]byte(want), []byte(h)) == 1 {
			found = i
		}
	}
	return found
}
