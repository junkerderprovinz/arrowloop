package state

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
	"unsafe"
)

// A run holds a job's record for as long as it plans, and a job over a code
// folder can hold hundreds of thousands of files. Both sides almost always
// agree on a file's name and hash, so holding each twice is most of the cost.
func TestTheRecordHoldsWhatBothSidesShareOnce(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	at := time.Unix(1700000000, 0)

	const n = 200
	want := 0
	for i := range n {
		name := fmt.Sprintf("Projects/Arrow/internal/File%04d.go", i)
		if i%4 == 0 {
			name = strings.ToLower(name)
		}
		key := strings.ToLower(name)
		hash := fmt.Sprintf("%032x", i)
		err := db.Put(ctx, Entry{
			Path: key, LeftPath: name, RightPath: name,
			LeftSize: 10, LeftMod: at, LeftHash: hash,
			RightSize: 10, RightMod: at, RightHash: hash,
			AgreedAt: at,
		})
		if err != nil {
			t.Fatal(err)
		}
		want += len(hash) + len(key)
		if name != key {
			want += len(name)
		}
	}

	all, err := db.All(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != n {
		t.Fatalf("read %d records of %d", len(all), n)
	}
	held := map[*byte]int{}
	for key, e := range all {
		for _, s := range []string{key, e.Path, e.LeftPath, e.RightPath, e.LeftHash, e.RightHash} {
			if s != "" {
				held[unsafe.StringData(s)] = len(s)
			}
		}
	}
	got := 0
	for _, size := range held {
		got += size
	}
	if got > want {
		t.Errorf("the record of %d files holds %d bytes of names and hashes where %d would do", n, got, want)
	}
}

func TestTheRecordKeepsNamesAndHashesTheSidesDisagreeOn(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	at := time.Unix(1700000000, 0)
	put := Entry{
		Path: "café.txt", LeftPath: "Café.txt", RightPath: "Café.txt",
		LeftSize: 4, LeftMod: at, LeftHash: "aaaa",
		RightSize: 5, RightMod: at, RightHash: "bbbb",
		AgreedAt: at,
	}
	same := Entry{Path: "same.txt", LeftPath: "same.txt", RightPath: "same.txt", LeftHash: "cc", RightHash: "cc", LeftMod: at, RightMod: at, AgreedAt: at}
	unhashed := Entry{Path: "none.txt", LeftPath: "None.txt", RightPath: "None.txt", LeftMod: at, RightMod: at, AgreedAt: at}
	for _, e := range []Entry{put, same, unhashed} {
		if err := db.Put(ctx, e); err != nil {
			t.Fatal(err)
		}
	}

	all, err := db.All(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range []Entry{put, same, unhashed} {
		got := all[e.Path]
		if got.Path != e.Path || got.LeftPath != e.LeftPath || got.RightPath != e.RightPath || got.LeftHash != e.LeftHash || got.RightHash != e.RightHash {
			t.Errorf("read back %+v\nwrote     %+v", got, e)
		}
	}
	one, ok, err := db.Get(ctx, put.Path)
	if err != nil || !ok {
		t.Fatalf("get: %v %v", ok, err)
	}
	if one.LeftPath != put.LeftPath || one.RightPath != put.RightPath || one.RightHash != put.RightHash {
		t.Errorf("Get read back %+v", one)
	}
}

// Rows kept from before a folder was excluded can be most of a job's record,
// and a run has no use for them.
func TestAReadLeavesOutWhatTheCallerDoesNotWant(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	at := time.Unix(1700000000, 0)
	for _, p := range []string{"src/main.go", "node_modules/a.js", "node_modules/b.js"} {
		if err := db.Put(ctx, Entry{Path: p, LeftPath: p, RightPath: p, LeftMod: at, RightMod: at, AgreedAt: at}); err != nil {
			t.Fatal(err)
		}
	}
	got, err := db.Matching(ctx, func(e Entry) bool { return !strings.HasPrefix(e.LeftPath, "node_modules/") })
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got["src/main.go"].LeftPath != "src/main.go" {
		t.Errorf("read %v, want only src/main.go", got)
	}
}
