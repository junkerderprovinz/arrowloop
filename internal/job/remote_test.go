package job

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/rclone/rclone/backend/alias"
	_ "github.com/rclone/rclone/backend/drive"
	_ "github.com/rclone/rclone/backend/ftp"
	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/onedrive"
	_ "github.com/rclone/rclone/backend/s3"
	_ "github.com/rclone/rclone/backend/sftp"
	_ "github.com/rclone/rclone/backend/smb"
	_ "github.com/rclone/rclone/backend/webdav"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
)

// Without a configuration of its own, the first test to look up a target
// would read the rclone.conf of whoever runs the tests.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "arrowloop-job-test")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	conf := filepath.Join(dir, "rclone.conf")
	if err := os.WriteFile(conf, nil, 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := config.SetConfigPath(conf); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	configfile.Install()
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

// targets saves remotes for one test, written "name: key=value key=value".
func targets(t *testing.T, lines ...string) {
	t.Helper()
	for _, line := range lines {
		name, settings, _ := strings.Cut(line, ":")
		for _, kv := range strings.Fields(settings) {
			k, v, _ := strings.Cut(kv, "=")
			config.FileSetValue(name, k, v)
		}
		t.Cleanup(func() { config.LoadedData().DeleteSection(name) })
	}
}

type placeCase struct {
	name  string
	a, b  string
	same  bool
	apart bool
}

func checkPlaces(t *testing.T, cases []placeCase) {
	t.Helper()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := sameSide(c.a, c.b); got != c.same {
				t.Errorf("%q and %q taken for one place: %v, want %v", c.a, c.b, got, c.same)
			}
			if got := Apart(c.a, c.b); got != c.apart {
				t.Errorf("%q and %q known to be two places: %v, want %v", c.a, c.b, got, c.apart)
			}
		})
	}
}

func TestServerTargetsAreComparedByHostPortAndUser(t *testing.T) {
	targets(t,
		"nas: type=sftp host=NAS.example user=bob",
		"nas2: type=sftp host=nas.example user=bob port=22",
		"alice: type=sftp host=nas.example user=alice",
		"other: type=sftp host=nas.example user=bob port=2222",
		"files: type=ftp host=nas.example user=bob",
		"files2: type=ftp host=nas.example user=bob port=21",
		"share: type=smb host=nas.example user=bob",
		"share2: type=smb host=NAS.example user=bob port=445",
	)
	checkPlaces(t, []placeCase{
		{"sftp under two names", "nas:fotos", "nas2:fotos/", true, false},
		{"sftp in another folder", "nas:fotos", "nas2:sicherung", false, true},
		{"sftp as another user", "nas:fotos", "alice:fotos", false, true},
		{"sftp on another port", "nas:fotos", "other:fotos", false, true},
		{"sftp from home and from the root", "nas:fotos", "nas2:/home/bob/fotos", false, false},
		{"sftp spelled as a connection string", "nas:fotos", ":sftp,host=nas.example,user=bob:fotos", true, false},
		{"ftp under two names", "files:fotos", "files2:fotos", true, false},
		{"ftp and sftp to one host", "files:fotos", "nas:fotos", false, true},
		{"smb ignores case", "share:Daten/Fotos", "share2:daten/fotos/", true, false},
	})
}

func TestBucketTargetsAreComparedByEndpointAndBucket(t *testing.T) {
	targets(t,
		"aws: type=s3 provider=AWS",
		"aws2: type=s3 provider=AWS endpoint=https://s3.eu-central-1.amazonaws.com/",
		"minio: type=s3 provider=Minio endpoint=http://minio.local:9000",
		"minio2: type=s3 provider=Minio endpoint=minio.local:9000",
		"vague: type=s3 provider=Minio",
	)
	checkPlaces(t, []placeCase{
		{"one AWS bucket under two names", "aws:eimer/fotos", "aws2:/eimer/fotos/", true, false},
		{"another bucket", "aws:eimer/fotos", "aws2:kuebel/fotos", false, true},
		{"case counts in a bucket", "aws:eimer/Fotos", "aws2:eimer/fotos", false, true},
		{"one MinIO bucket under two names", "minio:eimer", "minio2:eimer", true, false},
		{"the same bucket name elsewhere", "minio:eimer", "aws:eimer", false, true},
		{"a target without its endpoint", "vague:eimer", "minio:eimer", false, false},
	})
}

func TestWebdavTargetsAreComparedByAddress(t *testing.T) {
	targets(t,
		"cloud: type=webdav url=https://Cloud.example/remote.php/dav/files/bob/",
		"cloud2: type=webdav url=https://cloud.example:443/remote.php/dav/files/bob",
		"dav: type=webdav url=https://cloud.example/remote.php/dav",
		"elsewhere: type=webdav url=https://other.example/remote.php/dav/files/bob",
	)
	checkPlaces(t, []placeCase{
		{"one folder under two names", "cloud:fotos", "cloud2:fotos", true, false},
		{"the address carries part of the path", "cloud:fotos", "dav:files/bob/fotos", true, false},
		{"another server", "cloud:fotos", "elsewhere:fotos", false, true},
	})
}

func TestDriveTargetsAreComparedByTheirDrive(t *testing.T) {
	targets(t,
		"od: type=onedrive drive_id=b!abc drive_type=business",
		"od2: type=onedrive drive_id=b!abc",
		"od3: type=onedrive drive_id=b!xyz",
		"bare: type=onedrive",
		"team: type=drive team_drive=0AbC",
		"team2: type=drive team_drive=0AbC",
		"mine: type=drive",
	)
	checkPlaces(t, []placeCase{
		{"one OneDrive under two names, which ignores case", "od:Fotos", "od2:fotos", true, false},
		{"another OneDrive", "od:fotos", "od3:fotos", false, true},
		{"a OneDrive without its id", "bare:fotos", "od:fotos", false, false},
		{"one shared drive under two names", "team:fotos", "team2:fotos", true, false},
		{"case counts on Google Drive", "team:Fotos", "team2:fotos", false, true},
		{"a Google Drive whose account is not written down", "mine:fotos", "team:fotos", false, false},
	})
}

func TestAnAliasIsTheTargetItPointsAt(t *testing.T) {
	dir := t.TempDir()
	targets(t,
		"nas: type=sftp host=nas.example user=bob",
		"fotos: type=alias remote=nas:fotos",
		"disk: type=local",
		"here: type=alias remote="+filepath.ToSlash(dir),
		"loop: type=alias remote=loop:",
	)
	checkPlaces(t, []placeCase{
		{"an alias of a server folder", "fotos:2026", "nas:fotos/2026", true, false},
		{"an alias of another folder", "fotos:", "nas:sicherung", false, true},
		{"a local target", "disk:" + dir, dir, true, false},
		{"an alias of a local folder", "here:", dir, true, false},
		{"an alias of itself", "loop:", "nas:fotos", false, false},
	})
}

func TestATargetThatCannotBeFoundIsNeitherOnePlaceNorTwo(t *testing.T) {
	targets(t, "nas: type=sftp host=nas.example user=bob")
	checkPlaces(t, []placeCase{
		{"a name not in the configuration", "Garage:eimer", "nas:eimer", false, false},
		{"a backend this build lacks", ":nosuchbackend:eimer", "nas:eimer", false, false},
		{"one unknown name typed twice", "Garage:eimer", "Garage:eimer/", true, false},
		{"a folder here and a server", t.TempDir(), "nas:eimer", false, true},
	})
}

func TestAJobWithBothSidesOnOneServerUnderTwoNamesIsRefused(t *testing.T) {
	targets(t,
		"nas: type=sftp host=nas.example user=bob",
		"nas2: type=sftp host=nas.example user=bob port=22",
	)
	err := loadWithSides(t, "nas:fotos", "nas2:fotos")
	if err == nil || !strings.Contains(err.Error(), "snake eating its own tail") {
		t.Errorf("a job whose two names reach one folder loaded: %v", err)
	}
	if err := loadWithSides(t, "nas:fotos", "Garage:fotos"); err != nil {
		t.Errorf("a job with a target this machine cannot look up was refused: %v", err)
	}
}
