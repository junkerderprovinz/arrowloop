package dbfile

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func openDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestANewDatabaseIsStampedAndANewerOneRefused(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "state.db")
	db := openDB(t, path)
	if err := Stamp(ctx, db, path, 1); err != nil {
		t.Fatalf("a new database: %v", err)
	}
	var have int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&have); err != nil || have != 1 {
		t.Fatalf("the database carries version %d (%v), want 1", have, err)
	}

	if _, err := db.Exec(`PRAGMA user_version = 2`); err != nil {
		t.Fatal(err)
	}
	if err := Stamp(ctx, db, path, 1); !errors.Is(err, ErrNewer) {
		t.Errorf("a database from a newer build gave %v", err)
	}
	if err := Stamp(ctx, db, path, 2); err != nil {
		t.Errorf("the build that wrote it was refused: %v", err)
	}
}
