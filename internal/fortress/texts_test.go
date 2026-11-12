package fortress

import (
	"os"
	"regexp"
	"slices"
	"testing"
)

// The interface's language registry, read from its source so a language
// added there without texts here fails this test.
func offeredLanguages(t *testing.T) []string {
	t.Helper()
	src, err := os.ReadFile("../../web/src/lib/i18n.data.ts")
	if err != nil {
		t.Fatal(err)
	}
	var codes []string
	for _, m := range regexp.MustCompile(`\{ code: '([a-z]+)', label:`).FindAllStringSubmatch(string(src), -1) {
		codes = append(codes, m[1])
	}
	if len(codes) < 2 {
		t.Fatalf("found only %v in the registry", codes)
	}
	return codes
}

func TestEveryOfferedLanguageHasEveryText(t *testing.T) {
	placeholders := regexp.MustCompile(`\{[a-z]+\}`)
	for _, lang := range offeredLanguages(t) {
		table, ok := texts[lang]
		if !ok {
			t.Errorf("no texts for %s", lang)
			continue
		}
		for key, en := range texts["en"] {
			text, ok := table[key]
			if !ok || text == "" {
				t.Errorf("%s has no %s", lang, key)
				continue
			}
			want, got := placeholders.FindAllString(en, -1), placeholders.FindAllString(text, -1)
			slices.Sort(want)
			slices.Sort(got)
			if !slices.Equal(want, got) {
				t.Errorf("%s %s has the placeholders %v, English %v", lang, key, got, want)
			}
		}
		if len(table) != len(texts["en"]) {
			t.Errorf("%s has %d texts, English %d", lang, len(table), len(texts["en"]))
		}
	}
}
