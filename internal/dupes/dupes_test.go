package dupes

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/rclone/rclone/backend/local"
	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

func tree(t *testing.T, files map[string]string) rclonefs.Fs {
	t.Helper()
	root := t.TempDir()
	for name, body := range files {
		full := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	f, err := rclonefs.NewFs(context.Background(), root)
	if err != nil {
		t.Fatalf("open the tree: %v", err)
	}
	return f
}

func find(t *testing.T, f rclonefs.Fs) Report {
	t.Helper()
	got, err := Find(context.Background(), f, scan.Options{}, 0)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	return got
}

func TestTheSameFileInThreePlacesIsOneGroup(t *testing.T) {
	got := find(t, tree(t, map[string]string{
		"urlaub/strand.jpg":  "genau dieselben bytes",
		"backup/strand.jpg":  "genau dieselben bytes",
		"alt/kopie/foto.jpg": "genau dieselben bytes",
		"anderes.txt":        "etwas ganz anderes",
	}))

	if len(got.Groups) != 1 {
		t.Fatalf("found %d groups, wanted one", len(got.Groups))
	}
	group := got.Groups[0]
	if len(group.Paths) != 3 {
		t.Errorf("the group holds %d paths: %v", len(group.Paths), group.Paths)
	}
	if want := group.Size * 2; group.Wasted != want {
		t.Errorf("waste is %d, expected %d; the original is not a duplicate of itself", group.Wasted, want)
	}
	if got.Wasted != group.Wasted {
		t.Errorf("the total (%d) disagrees with the only group (%d)", got.Wasted, group.Wasted)
	}
}

func TestTwoFilesOfTheSameSizeAreNotDuplicates(t *testing.T) {
	got := find(t, tree(t, map[string]string{
		"eins.txt": "aaaaaaaaaaaa",
		"zwei.txt": "bbbbbbbbbbbb",
	}))
	if len(got.Groups) != 0 {
		t.Errorf("paired up two different files because they weigh the same: %v", got.Groups)
	}
}

func TestEmptyFilesAreNotReported(t *testing.T) {
	got := find(t, tree(t, map[string]string{
		"a/.gitkeep": "",
		"b/.gitkeep": "",
		"c/leer.txt": "",
	}))
	if len(got.Groups) != 0 {
		t.Errorf("reported empty files as duplicates: %v", got.Groups)
	}
	if got.Wasted != 0 {
		t.Errorf("claimed %d bytes could be reclaimed from empty files", got.Wasted)
	}
}

func TestASingleCopyIsNotAGroup(t *testing.T) {
	got := find(t, tree(t, map[string]string{
		"nur-einmal.txt": "einzelstueck",
		"anders.txt":     "etwas laengeres als das andere",
	}))
	if len(got.Groups) != 0 {
		t.Errorf("found duplicates where there are none: %v", got.Groups)
	}
	if got.Scanned != 2 {
		t.Errorf("scanned %d files, expected 2", got.Scanned)
	}
}

func TestTheBiggestWasteComesFirst(t *testing.T) {
	big := strings.Repeat("x", 4096)
	got := find(t, tree(t, map[string]string{
		"klein/a.txt": "kurz",
		"klein/b.txt": "kurz",
		"gross/a.bin": big,
		"gross/b.bin": big,
		"gross/c.bin": big,
		"nichts.txt":  "einzeln",
	}))
	if len(got.Groups) != 2 {
		t.Fatalf("found %d groups, wanted two", len(got.Groups))
	}
	if got.Groups[0].Size <= got.Groups[1].Size {
		t.Errorf("the small duplicate came first: %v", got.Groups)
	}
}

func TestTheCapLimitsTheListAndNotTheTotals(t *testing.T) {
	files := map[string]string{}
	for _, name := range []string{"a", "b", "c", "d"} {
		files[name+"/eins.txt"] = "inhalt " + name
		files[name+"/zwei.txt"] = "inhalt " + name
	}
	full, err := Find(context.Background(), tree(t, files), scan.Options{}, 0)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if len(full.Groups) != 4 {
		t.Fatalf("expected four groups, got %d", len(full.Groups))
	}

	capped, err := Find(context.Background(), tree(t, files), scan.Options{}, 2)
	if err != nil {
		t.Fatalf("find capped: %v", err)
	}
	if len(capped.Groups) != 2 {
		t.Errorf("the cap sent %d groups", len(capped.Groups))
	}
	if capped.Wasted != full.Wasted {
		t.Errorf("the cap changed the reclaimable total: %d against %d", capped.Wasted, full.Wasted)
	}
	if capped.Scanned != full.Scanned {
		t.Errorf("the cap changed how many files were scanned: %d against %d", capped.Scanned, full.Scanned)
	}
}

// A nil slice would marshal to null.
func TestNothingFoundIsAnEmptyListRatherThanNull(t *testing.T) {
	got := find(t, tree(t, map[string]string{"allein.txt": "eins"}))
	if got.Groups == nil {
		t.Error("an empty answer travels as null")
	}
}
