// Package dbfile holds the one rule both SQLite databases in this program need
// and neither of them used to follow.
//
// SQLite creates a database file that is not there. It does not create the
// FOLDER that file was asked to live in, and it cannot: a missing directory is
// indistinguishable from a typo, so refusing is the only safe answer a storage
// engine can give. The answer it gives is SQLITE_CANTOPEN, error 14, whose
// message is "unable to open database file" and which says nothing whatsoever
// about a directory.
//
// That mattered here because the interface hands every new job a state path of
// "state/<name>.db" - a folder nobody creates, under a config directory that
// ships without one. Every run of every job made that way failed, on the clock
// and on a change alike, with a message that read like a permissions problem.
package dbfile

import (
	"fmt"
	"os"
	"path/filepath"
)

// EnsureDir makes the folder a database file will live in.
//
// The mode is a ceiling rather than a promise: the process umask masks it, so
// this asks for the same 0755 every other directory in this program asks for
// and lets the umask have the last word. Nothing outside this process writes
// into a database folder, so there is no reason for it to be looser.
func EnsureDir(path string) error {
	dir := filepath.Dir(path)
	if dir == "" || dir == "." {
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create the folder for %s: %w", path, err)
	}
	return nil
}
