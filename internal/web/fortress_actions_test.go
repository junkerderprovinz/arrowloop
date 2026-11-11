package web_test

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/fortress"
	"github.com/junkerderprovinz/parleyport/kit/group"
	"github.com/junkerderprovinz/parleyport/kit/hostpath"
	"github.com/junkerderprovinz/parleyport/kit/lan"
	"github.com/junkerderprovinz/parleyport/kit/member"
	"github.com/junkerderprovinz/parleyport/kit/relay"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/remotes"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

type memStore struct {
	mu   sync.Mutex
	data []byte
}

func (s *memStore) Load() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return bytes.Clone(s.data), nil
}

func (s *memStore) Save(b []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = bytes.Clone(b)
	return nil
}

// openFortress opens app on device in a fortress of the test's phrase, met on
// the relay at relayURL or, without one, only on the network lan announces
// on. edit sets what the app brings.
func openFortress(t *testing.T, relayURL string, network *lan.Service, app, device string, edit func(*fortress.Config)) (*fortress.Fortress, string) {
	t.Helper()
	seed := sha256.Sum256([]byte(device))
	id, err := member.FromSeed(member.KindInstance, seed[:])
	if err != nil {
		t.Fatal(err)
	}
	var current atomic.Pointer[fortress.Fortress]
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if f := current.Load(); f != nil && r.URL.Path == group.DirectPath {
			f.DirectHandler().ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(direct.Close)
	cfg := fortress.Config{
		App:      fortress.App{ID: app, Name: app, Version: "1.0.0"},
		Secret:   []byte("a phrase both hold"),
		Identity: id,
		Self:     group.Self{Name: device, Deployment: "container", DirectURL: direct.URL},
		Relay:    group.RelayOff,
		LAN:      network,
		Store:    &memStore{},
	}
	if relayURL != "" {
		cfg.Relay, cfg.RelayURL = group.RelayOwn, relayURL
	}
	if edit != nil {
		edit(&cfg)
	}
	f, err := fortress.Open(cfg)
	if err != nil {
		t.Fatal(err)
	}
	current.Store(f)
	t.Cleanup(func() { _ = f.Close() })
	return f, id.ID()
}

// knows waits until f knows which app member id runs, which it learns from
// the phrase alone.
func knows(t *testing.T, f *fortress.Fortress, id, app string) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		for _, m := range f.Members() {
			if m.ID == id && m.App.ID == app {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("never learned that %s runs %s", id, app)
}

// fortressPair puts the engine h runs into a fortress with a downloader that
// uses its actions, and returns the downloader and the engine's member id.
func fortressPair(t *testing.T, h *harness) (*fortress.Fortress, *fortress.Fortress, string) {
	t.Helper()
	rel := httptest.NewServer(relay.New())
	t.Cleanup(rel.Close)
	t.Cleanup(rel.CloseClientConnections)
	s := &web.Server{History: h.history, Runner: h.runner}
	engine, engineID := openFortress(t, rel.URL, nil, "arrowloop", "Tower", func(c *fortress.Config) { c.Actions = s.FortressActions() })
	loader, loaderID := openFortress(t, rel.URL, nil, "knightloader", "Attic", func(c *fortress.Config) { c.Uses = []string{"jobs.list", "jobs.run"} })
	knows(t, loader, engineID, "arrowloop")
	knows(t, engine, loaderID, "knightloader")
	return engine, loader, engineID
}

func act(t *testing.T, f *fortress.Fortress, id, action string, body any, into any) error {
	t.Helper()
	var raw []byte
	if body != nil {
		var err error
		if raw, err = json.Marshal(body); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := f.Act(ctx, id, action, raw)
	if err != nil {
		return err
	}
	if into != nil {
		if err := json.Unmarshal(out, into); err != nil {
			t.Fatalf("%s answered %s: %v", action, out, err)
		}
	}
	return nil
}

func refusal(err error) string {
	var r *fortress.Refusal
	if errors.As(err, &r) {
		return r.Code
	}
	return ""
}

type listedJob struct {
	Name      string `json:"name"`
	Direction string `json:"direction"`
	Mode      string `json:"mode"`
	Paused    bool   `json:"paused"`
	Running   bool   `json:"running"`
	LastRun   *struct {
		At      time.Time `json:"at"`
		Outcome string    `json:"outcome"`
	} `json:"lastRun"`
}

func TestAnotherAppListsAndStartsJobsThroughTheFortress(t *testing.T) {
	h := engineFor(t, `{"jobs":[
		{"name":"photos","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/photos.db","quietPeriod":"0s"},
		{"name":"inbox","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/inbox.db","direction":"leftToRight","mode":"move","disabled":true}]}`)
	finished := time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	if err := h.history.Record(context.Background(), history.Run{Job: "photos", Started: finished.Add(-time.Minute), Finished: finished, Copied: 3}, nil); err != nil {
		t.Fatal(err)
	}
	engine, loader, engineID := fortressPair(t, h)

	t.Run("list", func(t *testing.T) {
		var jobs []listedJob
		if err := act(t, loader, engineID, "jobs.list", nil, &jobs); err != nil {
			t.Fatal(err)
		}
		byName := map[string]listedJob{}
		for _, j := range jobs {
			byName[j.Name] = j
		}
		photos, inbox := byName["photos"], byName["inbox"]
		if len(jobs) != 2 {
			t.Fatalf("listed %+v, want photos and inbox", jobs)
		}
		if photos.Name != "photos" || photos.Direction != "both" || photos.Mode != "sync" || photos.Paused || photos.Running ||
			photos.LastRun == nil || !photos.LastRun.At.Equal(finished) || photos.LastRun.Outcome != "done" {
			t.Errorf("photos listed as %+v", photos)
		}
		if inbox.Name != "inbox" || inbox.Direction != "leftToRight" || inbox.Mode != "move" || !inbox.Paused || inbox.LastRun != nil {
			t.Errorf("inbox listed as %+v", inbox)
		}
	})

	t.Run("run", func(t *testing.T) {
		var answer struct{ Job, Status string }
		if err := act(t, loader, engineID, "jobs.run", map[string]string{"job": "photos"}, &answer); err != nil {
			t.Fatal(err)
		}
		if answer.Job != "photos" || answer.Status != "started" && answer.Status != "queued" {
			t.Fatalf("jobs.run answered %+v", answer)
		}
		waitForRun(t, h, 2)
	})

	t.Run("refusals", func(t *testing.T) {
		for body, want := range map[string]string{`{"job":"outbox"}`: "no_such_job", `{"job":"inbox"}`: "job_paused", `{}`: "no_such_job", `[`: "bad_request"} {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			_, err := loader.Act(ctx, engineID, "jobs.run", []byte(body))
			cancel()
			if got := refusal(err); got != want {
				t.Errorf("jobs.run with %s: %v, want %s", body, err, want)
			}
		}
	})

	t.Run("permission off", func(t *testing.T) {
		if err := engine.SetPermission("knightloader", "arrowloop", "jobs.run", false); err != nil {
			t.Fatal(err)
		}
		if err := act(t, loader, engineID, "jobs.run", map[string]string{"job": "photos"}, nil); !errors.Is(err, fortress.ErrPermissionOff) {
			t.Errorf("jobs.run with the permission off: %v, want ErrPermissionOff", err)
		}
		if err := act(t, loader, engineID, "jobs.list", nil, nil); err != nil {
			t.Errorf("jobs.list went with jobs.run: %v", err)
		}
	})
}

// onTheNetwork is a network announce service on a multicast group of the
// test's own, or a skip on a host that cannot join one.
func onTheNetwork(t *testing.T, port int) *lan.Service {
	t.Helper()
	addr := netip.AddrPortFrom(netip.MustParseAddr("239.255.77.252"), uint16(port))
	probe, err := net.ListenMulticastUDP("udp4", nil, net.UDPAddrFromAddrPort(addr))
	if err != nil {
		t.Skipf("this host cannot join a multicast group: %v", err)
	}
	_ = probe.Close()
	s := lan.New(lan.Config{Group: addr})
	s.Start()
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func freeUDPPort(t *testing.T) int {
	t.Helper()
	c, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	return c.LocalAddr().(*net.UDPAddr).Port
}

func TestABackupToolOnTheSameNetworkFetchesTheExport(t *testing.T) {
	h := newHarness(t)
	if err := os.WriteFile(filepath.Join(h.left, "a.jpg"), []byte("abc"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := h.runner.Run(context.Background(), "photos"); err != nil {
		t.Fatal(err)
	}
	port := freeUDPPort(t)
	s := &web.Server{History: h.history, Runner: h.runner}
	_, engineID := openFortress(t, "", onTheNetwork(t, port), "arrowloop", "Tower", func(c *fortress.Config) { c.Export = s.FortressExport })
	vault, _ := openFortress(t, "", onTheNetwork(t, port), "bombvault", "Tower vault", func(c *fortress.Config) { c.Uses = []string{fortress.ExportAction} })
	knows(t, vault, engineID, "arrowloop")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	backup, err := vault.Export(ctx, engineID)
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	names := map[string][]byte{}
	tr := tar.NewReader(backup)
	for {
		hd, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		names[hd.Name], _ = io.ReadAll(tr)
	}
	config, err := os.ReadFile(h.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(names["arrowloop.json"], config) {
		t.Errorf("the export holds the configuration as %q", names["arrowloop.json"])
	}
	if _, ok := names["photos.db"]; !ok {
		t.Errorf("the export holds %d files, without photos.db", len(names))
	}
}

// containerMounts is the mount table of an engine in a container on Unraid:
// its own configuration, the downloads and the media share, and a file
// Docker puts in.
const containerMounts = `1203 1012 0:345 / / rw,relatime - overlay overlay rw,lowerdir=/a:/b
1204 1203 0:350 / /proc rw,nosuid - proc proc rw
1210 1203 0:46 /appdata/arrowloop /config rw,noatime - fuse.shfs shfs rw
1211 1203 0:46 /downloads /downloads rw,noatime - fuse.shfs shfs rw
1212 1203 0:46 /media /media rw,noatime - fuse.shfs shfs rw
1215 1203 8:17 /var/lib/docker/containers/4b1d/hostname /etc/hostname rw,relatime - btrfs /dev/sdb1 rw
`

type target struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Where string `json:"where"`
}

func TestAnotherAppCreatesAJobFromItsCategoryFolder(t *testing.T) {
	if err := remotes.Save("nas", "sftp", map[string]string{"host": "nas.lan", "user": "ana", "pass": "hunter2"}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = remotes.Delete("nas") })
	h := newHarness(t)
	tab, err := hostpath.Parse(strings.NewReader(containerMounts))
	if err != nil {
		t.Fatal(err)
	}
	rel := httptest.NewServer(relay.New())
	t.Cleanup(rel.Close)
	t.Cleanup(rel.CloseClientConnections)
	s := &web.Server{History: h.history, Runner: h.runner, Mounts: func() (hostpath.Table, error) { return tab, nil }}
	engine, engineID := openFortress(t, rel.URL, nil, "arrowloop", "Tower", func(c *fortress.Config) { c.Actions = s.FortressActions() })
	loader, loaderID := openFortress(t, rel.URL, nil, "knightloader", "Attic", func(c *fortress.Config) { c.Uses = []string{"jobs.targets", "jobs.create"} })
	knows(t, loader, engineID, "arrowloop")
	knows(t, engine, loaderID, "knightloader")

	t.Run("targets", func(t *testing.T) {
		var targets []target
		if err := act(t, loader, engineID, "jobs.targets", nil, &targets); err != nil {
			t.Fatal(err)
		}
		byID := map[string]target{}
		for _, tg := range targets {
			byID[tg.ID] = tg
		}
		for _, want := range []target{
			{ID: "share:/downloads", Name: "downloads", Kind: "share", Where: "/mnt/user/downloads"},
			{ID: "share:/media", Name: "media", Kind: "share", Where: "/mnt/user/media"},
			{ID: "remote:nas", Name: "nas", Kind: "remote", Where: "sftp nas.lan"},
		} {
			if got := byID[want.ID]; got != want {
				t.Errorf("target %s listed as %+v, want %+v", want.ID, got, want)
			}
		}
		for id := range byID {
			if id == "share:/etc/hostname" || id == "share:/" || id == "share:/proc" {
				t.Errorf("%s is listed as a target", id)
			}
		}
		raw, _ := json.Marshal(targets)
		if strings.Contains(string(raw), "ana") || strings.Contains(string(raw), "hunter2") {
			t.Errorf("the targets carry a login: %s", raw)
		}
	})

	t.Run("create", func(t *testing.T) {
		for _, c := range []struct {
			body                   map[string]string
			left, right, dir, mode string
		}{
			{map[string]string{"name": "Movies", "source": "/mnt/user/downloads/movies", "target": "share:/media", "mode": "move"}, "/downloads/movies", "/media/Movies", "leftToRight", "move"},
			{map[string]string{"name": "Books", "source": "/mnt/user/downloads/books", "target": "remote:nas", "mode": "mirror"}, "/downloads/books", "nas:Books", "leftToRight", "mirror"},
			{map[string]string{"name": "Music", "source": "/mnt/user/downloads/music", "target": "share:/media", "mode": "sync"}, "/downloads/music", "/media/Music", "", ""},
		} {
			var answer struct{ Job string }
			if err := act(t, loader, engineID, "jobs.create", c.body, &answer); err != nil || answer.Job != c.body["name"] {
				t.Fatalf("jobs.create %v: %+v, %v", c.body, answer, err)
			}
			j, ok := h.runner.Config().Find(c.body["name"])
			if !ok {
				t.Fatalf("%s was not saved", c.body["name"])
			}
			if j.Left != c.left || j.Right != c.right || j.Direction != c.dir || j.Mode != c.mode {
				t.Errorf("%s saved as %s to %s, %q %q", j.Name, j.Left, j.Right, j.Direction, j.Mode)
			}
		}
	})

	t.Run("refusals", func(t *testing.T) {
		for body, want := range map[string]string{
			`{"name":"Movies","source":"/mnt/user/downloads/x","target":"share:/media","mode":"move"}`:     "name_taken",
			`{"name":"New","source":"/mnt/user/downloads/x","target":"share:/films","mode":"move"}`:        "no_such_target",
			`{"name":"New","source":"/mnt/user/downloads/x","target":"share:/etc/hostname","mode":"move"}`: "no_such_target",
			`{"name":"New","source":"/mnt/user/isos","target":"share:/media","mode":"move"}`:               "source_not_mounted",
			`{"name":"New","source":"/mnt/user/downloads/../isos","target":"share:/media","mode":"move"}`:  "bad_request",
			`{"name":"New","source":"/mnt/user/downloads/x","target":"share:/media","mode":"fast"}`:        "bad_request",
			`{"name":"a/b","source":"/mnt/user/downloads/x","target":"share:/media","mode":"move"}`:        "bad_request",
			`{"source":"/mnt/user/downloads/x","target":"share:/media","mode":"move"}`:                     "bad_request",
			`[`: "bad_request",
		} {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			_, err := loader.Act(ctx, engineID, "jobs.create", []byte(body))
			cancel()
			if got := refusal(err); got != want {
				t.Errorf("jobs.create with %s: %v, want %s", body, err, want)
			}
		}
	})

	t.Run("permission off", func(t *testing.T) {
		if err := engine.SetPermission("knightloader", "arrowloop", "jobs.create", false); err != nil {
			t.Fatal(err)
		}
		body := map[string]string{"name": "Later", "source": "/mnt/user/downloads/x", "target": "share:/media", "mode": "move"}
		if err := act(t, loader, engineID, "jobs.create", body, nil); !errors.Is(err, fortress.ErrPermissionOff) {
			t.Errorf("jobs.create with the permission off: %v, want ErrPermissionOff", err)
		}
		if err := act(t, loader, engineID, "jobs.targets", nil, nil); err != nil {
			t.Errorf("jobs.targets went with jobs.create: %v", err)
		}
	})
}
