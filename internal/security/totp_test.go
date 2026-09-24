package security

import (
	"strings"
	"testing"
	"time"
)

// The RFC 6238 vectors prove this is the algorithm authenticator apps run. The
// RFC's secret is the ASCII string "12345678901234567890"; here it is base32,
// as an app receives it.
const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" // RFC 6238 test vector gitleaks:allow

func TestTOTPMatchesRFC6238Vectors(t *testing.T) {
	// The RFC's SHA-1 vectors have eight digits; the last six are what a
	// six-digit app shows.
	cases := []struct {
		unix int64
		want string
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1111111111, "050471"},
		{1234567890, "005924"},
		{2000000000, "279037"},
	}
	for _, c := range cases {
		got, err := TOTPCode(rfcSecret, time.Unix(c.unix, 0))
		if err != nil {
			t.Fatalf("TOTPCode(%d): %v", c.unix, err)
		}
		if got != c.want {
			t.Fatalf("TOTPCode at %d = %s, want %s", c.unix, got, c.want)
		}
	}
}

func TestValidTOTPAcceptsTheCurrentCode(t *testing.T) {
	now := time.Unix(1111111109, 0)
	code, err := TOTPCode(rfcSecret, now)
	if err != nil {
		t.Fatal(err)
	}
	if !ValidTOTP(rfcSecret, code, now) {
		t.Fatal("the code for this moment was refused")
	}
	if !ValidTOTP(rfcSecret, code[:3]+" "+code[3:], now) {
		t.Fatal("a code typed with a space in the middle was refused")
	}
}

func TestValidTOTPWindowIsOneStepEitherSide(t *testing.T) {
	now := time.Unix(1111111109, 0)
	code, err := TOTPCode(rfcSecret, now)
	if err != nil {
		t.Fatal(err)
	}
	for _, delta := range []time.Duration{-30 * time.Second, 30 * time.Second} {
		if !ValidTOTP(rfcSecret, code, now.Add(delta)) {
			t.Fatalf("a code did not survive %v of clock skew", delta)
		}
	}
	for _, delta := range []time.Duration{-90 * time.Second, 90 * time.Second} {
		if ValidTOTP(rfcSecret, code, now.Add(delta)) {
			t.Fatalf("a code was accepted %v away", delta)
		}
	}
}

// The step is what lets the login refuse a code it has seen before, so it has
// to name the window the code came from rather than the current one.
func TestMatchTOTPNamesTheStepTheCodeBelongsTo(t *testing.T) {
	now := time.Unix(1111111109, 0)
	earlier := now.Add(-30 * time.Second)
	code, err := TOTPCode(rfcSecret, earlier)
	if err != nil {
		t.Fatal(err)
	}
	step, ok := MatchTOTP(rfcSecret, code, now)
	if !ok {
		t.Fatal("the previous window's code was refused")
	}
	if want := totpStep(earlier); step != want {
		t.Fatalf("step = %d, want %d, the window the code was made for", step, want)
	}
}

func TestValidTOTPRejectsRubbish(t *testing.T) {
	now := time.Unix(1111111109, 0)
	for _, code := range []string{"", "12345", "1234567", "abcdef", "00000000"} {
		if ValidTOTP(rfcSecret, code, now) {
			t.Fatalf("%q was accepted", code)
		}
	}
	// An unusable secret refuses everything rather than failing open.
	if ValidTOTP("not base32!", "123456", now) {
		t.Fatal("an invalid secret accepted a code")
	}
	if ValidTOTP("", "123456", now) {
		t.Fatal("an empty secret accepted a code")
	}
}

func TestNewTOTPSecretIsUsableAndFresh(t *testing.T) {
	a, err := NewTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("two secrets came out the same")
	}
	now := time.Now()
	code, err := TOTPCode(a, now)
	if err != nil {
		t.Fatalf("a fresh secret produced no code: %v", err)
	}
	if !ValidTOTP(a, code, now) {
		t.Fatal("a fresh secret refused its own code")
	}
	if ValidTOTP(b, code, now) {
		t.Fatal("one secret's code was accepted under another")
	}
}

func TestTOTPURICarriesWhatAnAppNeeds(t *testing.T) {
	uri := TOTPURI("ArrowLoop", "tower", "ABCDEFGH")
	for _, want := range []string{
		"otpauth://totp/",
		"secret=ABCDEFGH",
		"issuer=ArrowLoop",
		"digits=6",
		"period=30",
		"algorithm=SHA1",
	} {
		if !strings.Contains(uri, want) {
			t.Fatalf("the otpauth address lacks %q: %s", want, uri)
		}
	}
}

func TestRecoveryCodesMatchOnlyThemselves(t *testing.T) {
	plain, hashed, err := NewRecoveryCodes()
	if err != nil {
		t.Fatal(err)
	}
	if len(plain) != recoveryCodeCount || len(hashed) != recoveryCodeCount {
		t.Fatalf("want %d codes, got %d and %d", recoveryCodeCount, len(plain), len(hashed))
	}
	seen := map[string]bool{}
	for i, code := range plain {
		if seen[code] {
			t.Fatalf("recovery code %q came out twice", code)
		}
		seen[code] = true
		if strings.Contains(hashed[i], code) {
			t.Fatalf("the stored form contains the code itself")
		}
		if got := MatchRecoveryCode(code, hashed); got != i {
			t.Fatalf("code %d matched index %d", i, got)
		}
	}
	if MatchRecoveryCode("abcde-fghij", hashed) >= 0 {
		t.Fatal("an invented code matched")
	}
	if MatchRecoveryCode("", hashed) >= 0 {
		t.Fatal("an empty code matched")
	}
}

func TestRecoveryCodeForgivesHowItIsTyped(t *testing.T) {
	plain, hashed, err := NewRecoveryCodes()
	if err != nil {
		t.Fatal(err)
	}
	code := plain[3]
	for _, typed := range []string{
		strings.ToUpper(code),
		strings.ReplaceAll(code, "-", ""),
		strings.ReplaceAll(code, "-", " "),
		"  " + code + "  ",
	} {
		if MatchRecoveryCode(typed, hashed) != 3 {
			t.Fatalf("%q was refused", typed)
		}
	}
}

func TestTOTPClampsAPreEpochClockToStepZero(t *testing.T) {
	before := time.Unix(-86400, 0)
	got, err := TOTPCode(rfcSecret, before)
	if err != nil {
		t.Fatalf("TOTPCode: %v", err)
	}
	atZero, err := TOTPCode(rfcSecret, time.Unix(0, 0))
	if err != nil {
		t.Fatalf("TOTPCode at the epoch: %v", err)
	}
	if got != atZero {
		t.Fatalf("a clock before 1970 gave %s, step 0 is %s", got, atZero)
	}
	if !ValidTOTP(rfcSecret, got, before) {
		t.Fatal("the clamped code does not verify at the same clamped time")
	}
}
