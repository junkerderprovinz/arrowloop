package security

import (
	"os"
	"strings"
	"testing"
)

func TestAReadTokenIsKnownByItsPlainTextOnly(t *testing.T) {
	dir := t.TempDir()
	s := openIn(t, dir)
	plain, tok, err := s.AddReadToken("Homepage", 1700000000)
	if err != nil {
		t.Fatal(err)
	}
	if tok.ID == "" || tok.Name != "Homepage" || tok.CreatedAt != 1700000000 {
		t.Errorf("the new token came back as %+v", tok)
	}

	got, ok := openIn(t, dir).MatchReadToken(plain)
	if !ok || got.ID != tok.ID {
		t.Fatalf("the token was not recognised after a restart: %+v, %v", got, ok)
	}
	for _, wrong := range []string{"", plain + "x", plain[:len(plain)-1], strings.ToUpper(plain)} {
		if _, ok := s.MatchReadToken(wrong); ok {
			t.Errorf("%q was taken for the token", wrong)
		}
	}
}

func TestTheFileHoldsNoReadTokenInClear(t *testing.T) {
	s := openIn(t, t.TempDir())
	plain, _, err := s.AddReadToken("Homarr", 1)
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), plain) {
		t.Fatal("security.json holds the read token as it was handed out")
	}
}

func TestAReadTokenFromAnotherKeyIsNotAccepted(t *testing.T) {
	dir := t.TempDir()
	plain, _, err := openIn(t, dir).AddReadToken("Homepage", 1)
	if err != nil {
		t.Fatal(err)
	}
	other := make([]byte, len(testKey))
	copy(other, testKey)
	other[0] ^= 1
	s, err := Open(dir+"/arrowloop.json", other)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := s.MatchReadToken(plain); ok {
		t.Fatal("a token was accepted under another install key")
	}
}

func TestADeletedReadTokenOpensNothing(t *testing.T) {
	s := openIn(t, t.TempDir())
	plain, tok, err := s.AddReadToken("Homepage", 1)
	if err != nil {
		t.Fatal(err)
	}
	keep, _, err := s.AddReadToken("Homarr", 2)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteReadToken(tok.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.MatchReadToken(plain); ok {
		t.Error("a deleted token still opens")
	}
	if _, ok := s.MatchReadToken(keep); !ok {
		t.Error("deleting one token took another with it")
	}
	if got := s.Get().ReadTokens; len(got) != 1 || got[0].Name != "Homarr" {
		t.Errorf("the tokens left are %+v", got)
	}
}

func TestTwoReadTokensDiffer(t *testing.T) {
	s := openIn(t, t.TempDir())
	a, ta, _ := s.AddReadToken("a", 1)
	b, tb, _ := s.AddReadToken("b", 1)
	if a == b || ta.ID == tb.ID {
		t.Fatal("two tokens came out the same")
	}
}
