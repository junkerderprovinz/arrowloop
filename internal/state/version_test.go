package state

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/dbfile"
)

func TestAStateFromANewerBuildIsRefused(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.db")
	db, err := Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`PRAGMA user_version = 99`); err != nil {
		t.Fatal(err)
	}
	raw.Close()

	if _, err := Open(context.Background(), path); !errors.Is(err, dbfile.ErrNewer) {
		t.Errorf("a state database a newer build wrote opened with %v", err)
	}
}
