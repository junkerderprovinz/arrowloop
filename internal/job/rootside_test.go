package job

import (
	"strings"
	"testing"

	"github.com/rclone/rclone/fs/config"

	"github.com/junkerderprovinz/arrowloop/internal/appdata"
)

func TestAJobIsRefusedWhereItWouldWriteToTheRootTarget(t *testing.T) {
	config.FileSetValue(appdata.Root.Name, "type", "sftp")
	config.FileSetValue(appdata.Root.Name, "host", "127.0.0.1")
	config.FileSetValue(appdata.Root.Name, "description", appdata.Root.Marker)
	t.Cleanup(func() { config.LoadedData().DeleteSection(appdata.Root.Name) })

	cases := []struct {
		direction, mode string
		rootLeft        bool
		refused         bool
	}{
		{"both", "", true, true},
		{"both", "", false, true},
		{"leftToRight", "sync", true, false},
		{"leftToRight", "mirror", true, false},
		{"leftToRight", "move", true, true},
		{"leftToRight", "sync", false, true},
		{"rightToLeft", "", false, false},
		{"rightToLeft", "mirror", true, true},
		{"rightToLeft", "move", false, true},
	}
	for _, c := range cases {
		left, right := "Root:/storage/emulated/0/DCIM", t.TempDir()
		if !c.rootLeft {
			left, right = right, left
		}
		cfg := loadBody(t, `{"jobs":[{"name":"Test","left":`+quote(left)+`,"right":`+quote(right)+
			`,"direction":"`+c.direction+`","mode":"`+c.mode+`","state":"x.db"}]}`)
		j, _ := cfg.Find("Test")
		err := j.Refused()
		if c.refused && (err == nil || !strings.Contains(err.Error(), "only reads")) {
			t.Errorf("%s %s with Root on the left %t: %v, want a refusal", c.direction, c.mode, c.rootLeft, err)
		}
		if !c.refused && err != nil {
			t.Errorf("%s %s with Root on the left %t was refused: %v", c.direction, c.mode, c.rootLeft, err)
		}
	}
}

func TestATargetSomeoneNamedRootTakesWrites(t *testing.T) {
	targets(t, "Root: type=local")
	cfg := loadBody(t, `{"jobs":[{"name":"Test","left":"Root:/a","right":`+quote(t.TempDir())+`,"state":"x.db"}]}`)
	j, _ := cfg.Find("Test")
	if err := j.Refused(); err != nil {
		t.Fatalf("refused: %v", err)
	}
}
