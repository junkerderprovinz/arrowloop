package web_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/fortress"
	"github.com/junkerderprovinz/parleyport/kit/group"
	"github.com/junkerderprovinz/parleyport/kit/member"
	"github.com/junkerderprovinz/parleyport/kit/relay"

	"github.com/junkerderprovinz/arrowloop/internal/history"
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

func openFortress(t *testing.T, relayURL, app, device string, actions []fortress.Action, uses []string) (*fortress.Fortress, string) {
	t.Helper()
	seed := sha256.Sum256([]byte(device))
	id, err := member.FromSeed(member.KindInstance, seed[:])
	if err != nil {
		t.Fatal(err)
	}
	f, err := fortress.Open(fortress.Config{
		App:      fortress.App{ID: app, Name: app, Version: "1.0.0"},
		Secret:   []byte("a phrase both hold"),
		Identity: id,
		Self:     group.Self{Name: device, Deployment: "container"},
		Relay:    group.RelayOwn,
		RelayURL: relayURL,
		Store:    &memStore{},
		Actions:  actions,
		Uses:     uses,
	})
	if err != nil {
		t.Fatal(err)
	}
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
	engine, engineID := openFortress(t, rel.URL, "arrowloop", "Tower", s.FortressActions(), nil)
	loader, loaderID := openFortress(t, rel.URL, "knightloader", "Attic", nil, []string{"jobs.list", "jobs.run"})
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
