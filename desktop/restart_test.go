package main

import (
	"slices"
	"testing"
)

func TestARestartKeepsTheArgumentsAndWaitsForTheOldProcess(t *testing.T) {
	cases := [][]string{
		{"--config", "x.json"},
		{"--config", "x.json", "--after", "12"},
		{"-after=12", "--config", "x.json"},
	}
	for _, args := range cases {
		got := againArgs(args, 34)
		if want := []string{"--config", "x.json", "--after", "34"}; !slices.Equal(got, want) {
			t.Errorf("%q: got %q, want %q", args, got, want)
		}
	}
}
