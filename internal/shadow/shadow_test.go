package shadow

import "testing"

func TestSplitFindsTheDriveInEveryFormRcloneUses(t *testing.T) {
	for _, tc := range []struct{ in, volume, rest string }{
		{`C:\Users\me\Documents`, "C:", `\Users\me\Documents`},
		{`//?/c:/Users/me/`, "C:", `\Users\me`},
		{`\\?\D:\`, "D:", ""},
		{`E:`, "E:", ""},
	} {
		volume, rest, err := split(tc.in)
		if err != nil {
			t.Errorf("%s: %v", tc.in, err)
			continue
		}
		if volume != tc.volume || rest != tc.rest {
			t.Errorf("%s split into %q and %q, want %q and %q", tc.in, volume, rest, tc.volume, tc.rest)
		}
	}
}

func TestSplitRefusesWhatHasNoShadowCopy(t *testing.T) {
	for _, in := range []string{`\\server\share\folder`, `/home/me`, ``} {
		if _, _, err := split(in); err == nil {
			t.Errorf("%q was taken for a drive", in)
		}
	}
}
