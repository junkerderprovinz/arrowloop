package main

import (
	"maps"
	"os"
	"regexp"
	"slices"
	"testing"
)

func TestEveryAppLanguageNamesWhatStays(t *testing.T) {
	data, err := os.ReadFile("../../web/src/lib/i18n.data.ts")
	if err != nil {
		t.Fatal(err)
	}
	var languages []string
	for _, m := range regexp.MustCompile(`\{ code: '([a-z]+)'`).FindAllSubmatch(data, -1) {
		languages = append(languages, string(m[1]))
	}
	slices.Sort(languages)
	if got := slices.Sorted(maps.Keys(stays)); !slices.Equal(got, languages) {
		t.Fatalf("stays has %v, the app %v", got, languages)
	}
	for lang, s := range stays {
		if s.Item == "" || len(s.Note) <= len(s.Item) {
			t.Errorf("%s: %+v", lang, s)
		}
	}
}
