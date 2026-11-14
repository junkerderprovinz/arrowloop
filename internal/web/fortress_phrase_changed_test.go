package web_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/fortress"
	"github.com/junkerderprovinz/parleyport/kit/group"
	"github.com/junkerderprovinz/parleyport/kit/member"
	"github.com/junkerderprovinz/parleyport/kit/phrase"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

func TestAMemberThatNeverSaidItsAppShowsByItsDevice(t *testing.T) {
	seen := time.Now().Add(-time.Hour)
	views := web.MemberViews([]fortress.Member{{
		ID: "instance-cellar", Kind: member.KindInstance, Device: "Cellar", Deployment: "plugin",
		State: group.StateApproved, LastSeen: seen, Actions: []string{fortress.OpenAction},
	}})
	if len(views) != 1 {
		t.Fatalf("the fortress lists %+v, want the member on Cellar", views)
	}
	v := views[0]
	if v.ID != "instance-cellar" || v.App != "" || v.Device != "Cellar" || v.Online || v.LastSeen != seen.Unix() {
		t.Errorf("the member reads %+v, want it away on Cellar with no app", v)
	}
	if v.Pages {
		t.Error("a member whose app is unknown offers its pages")
	}
}

type leftEntry struct {
	App    string `json:"app"`
	Device string `json:"device"`
}

// appOnDevice opens another app on device, under a key of its own.
func appOnDevice(t *testing.T, relayURL string, secret []byte, app, name, device string) (*fortress.Fortress, string) {
	t.Helper()
	seed := sha256.Sum256([]byte(app + " on " + device))
	id, err := member.FromSeed(member.KindInstance, seed[:])
	if err != nil {
		t.Fatal(err)
	}
	f, _ := openFortress(t, relayURL, nil, app, device, func(c *fortress.Config) {
		c.App.Name, c.Secret, c.Identity = name, secret, id
		// On the relay alone, so that closing it takes it away.
		c.Self.DirectURL = ""
	})
	return f, id.ID()
}

func TestAPhraseChangeNamesEveryAppOnADeviceStillOnTheOldPhrase(t *testing.T) {
	n, url, secret := inFortressOnRelay(t)
	bomb, bombID := appOnDevice(t, url, secret, "bombvault", "BombVault", "Tower")
	fire, fireID := appOnDevice(t, url, secret, "firesquire", "FireSquire", "Tower")
	eventually(t, "the instance to know both apps on Tower", func() bool {
		known := 0
		for _, m := range n.fortress(t).Members {
			if (m.ID == bombID || m.ID == fireID) && m.App != "" {
				known++
			}
		}
		return known == 2
	})
	_ = bomb.Close()
	_ = fire.Close()
	eventually(t, "both apps to be away", func() bool {
		for _, m := range n.fortress(t).Members {
			if m.Online {
				return false
			}
		}
		return true
	})

	status, body := n.send(t, http.MethodPost, "/api/fortress/phrase", `{}`)
	var changed struct {
		Left []leftEntry `json:"left"`
	}
	if err := json.Unmarshal(body, &changed); status != http.StatusOK || err != nil {
		t.Fatalf("the change answered %d %s", status, body)
	}
	want := []leftEntry{{App: "BombVault", Device: "Tower"}, {App: "FireSquire", Device: "Tower"}}
	if !slices.Equal(changed.Left, want) {
		t.Errorf("the change left %+v on the old phrase, want %+v", changed.Left, want)
	}
}

// keptSecret is the keeper of the app that changes the phrase in a test.
type keptSecret struct {
	mu     sync.Mutex
	secret []byte
}

func (k *keptSecret) Keep(secret []byte) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.secret = bytes.Clone(secret)
	return nil
}

func (k *keptSecret) kept() []byte {
	k.mu.Lock()
	defer k.mu.Unlock()
	return bytes.Clone(k.secret)
}

type phraseChangedInfo struct {
	Joined        bool `json:"joined"`
	PhraseChanged bool `json:"phraseChanged"`
}

func (n *node) phraseChanged(t *testing.T) phraseChangedInfo {
	t.Helper()
	var v phraseChangedInfo
	n.get(t, "/api/fortress", &v)
	return v
}

func TestAnInstanceWhoseContactsMovedAsksForTheNewWordsAndStaysTheSameMember(t *testing.T) {
	n, url, old := inFortressOnRelay(t)
	store, keeper := &memStore{}, &keptSecret{}
	changerAt := func(secret, previous []byte) (*fortress.Fortress, string) {
		return openFortress(t, url, nil, "bombvault", "Atlas", func(c *fortress.Config) {
			c.Secret, c.Previous, c.Store, c.Keeper = secret, previous, store, keeper
		})
	}
	changer, _ := changerAt(old, nil)
	p := joinPlugin(t, url, old)
	p.open(t)
	eventually(t, "everybody to know everybody", func() bool {
		apps := map[string]bool{}
		for _, m := range n.fortress(t).Members {
			apps[m.App] = true
		}
		return apps["bombvault"] && apps["firesquire"] && p.reaches() &&
			slices.ContainsFunc(changer.Members(), func(m fortress.Member) bool { return m.App.ID == "firesquire" })
	})
	p.close()

	// ArrowLoop is away for the change, and the plugin follows it later.
	n.server.StopPairing()
	eventually(t, "ArrowLoop to be away", func() bool {
		return !slices.ContainsFunc(changer.Members(), func(m fortress.Member) bool { return m.App.ID == "arrowloop" && m.Online() })
	})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := changer.ChangePhrase(ctx); err != nil {
		t.Fatal(err)
	}
	next := keeper.kept()
	_ = changer.Close()
	moved, _ := changerAt(next, old)
	p.open(t)
	eventually(t, "the plugin to follow the change", func() bool {
		followed, err := fortress.Follow(ctx, p.dir, p.f)
		if err != nil {
			t.Logf("follow: %v", err)
		}
		return followed
	})
	p.close()
	_ = moved.Close()
	p.open(t)

	n.server.StartPairing()
	eventually(t, "ArrowLoop to hear that the phrase changed", func() bool { return n.phraseChanged(t).PhraseChanged })

	words, err := phrase.Encode(next)
	if err != nil {
		t.Fatal(err)
	}
	n.join(t, words)
	if !bytes.Equal(n.server.Pairing.Get().Secret, next) {
		t.Error("ArrowLoop does not keep the new phrase")
	}
	eventually(t, "the plugin to meet ArrowLoop under the new phrase", p.reaches)
	if v := n.phraseChanged(t); !v.Joined || v.PhraseChanged {
		t.Errorf("after the new words the fortress reads %+v", v)
	}
}
