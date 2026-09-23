package main

import (
	"io"
	"os"
	"testing"
)

func TestAPipedPasswordIsTheFirstLineWithoutItsLineEnding(t *testing.T) {
	for _, c := range []struct {
		name  string
		input string
		want  string
	}{
		{name: "echo on Linux", input: "s3cret\n", want: "s3cret"},
		{name: "echo in PowerShell", input: "s3cret\r\n", want: "s3cret"},
		{name: "printf with no newline at all", input: "s3cret", want: "s3cret"},
		{name: "spaces inside belong to the password", input: " two words \n", want: " two words "},
		{name: "a second line is not part of it", input: "s3cret\nleftover\n", want: "s3cret"},
	} {
		t.Run(c.name, func(t *testing.T) {
			r, w, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			if _, err := io.WriteString(w, c.input); err != nil {
				t.Fatal(err)
			}
			w.Close()

			got, err := readPassword(r, io.Discard)
			if err != nil {
				t.Fatalf("read the password: %v", err)
			}
			if got != c.want {
				t.Errorf("read %q, want %q", got, c.want)
			}
		})
	}
}
