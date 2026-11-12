package web_test

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/fortress"
	"github.com/junkerderprovinz/parleyport/kit/phrase"
)

// plugin is a member that holds only the fortress keys, kept in a folder of
// its own, the way an Unraid plugin joins.
type plugin struct {
	dir string
	id  string
	f   *fortress.Fortress
}

func joinPlugin(t *testing.T, url string, sec []byte) *plugin {
	t.Helper()
	p := &plugin{dir: filepath.Join(t.TempDir(), "fortress")}
	if err := fortress.Join(p.dir, sec, fortress.Membership{App: "firesquire", Device: "tower", Relay: url}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.close)
	return p
}

func (p *plugin) open(t *testing.T) {
	t.Helper()
	cfg, err := fortress.Load(p.dir)
	if err != nil {
		t.Fatal(err)
	}
	if p.f, err = fortress.Open(cfg); err != nil {
		t.Fatal(err)
	}
	p.id = cfg.Identity.ID()
}

func (p *plugin) close() {
	if p.f != nil {
		_ = p.f.Close()
		p.f = nil
	}
}

// reaches reports whether p has another member online.
func (p *plugin) reaches() bool {
	for _, m := range p.f.Members() {
		if m.Online() {
			return true
		}
	}
	return false
}

// inFortressOnRelay joins a new instance to a new fortress on a relay of the
// test's own and returns the relay's address and the secret.
func inFortressOnRelay(t *testing.T) (*node, string, []byte) {
	t.Helper()
	url := testRelay(t)
	n := newNode(t, url)
	sec, words, err := phrase.New()
	if err != nil {
		t.Fatal(err)
	}
	n.join(t, words)
	return n, url, sec
}

func TestAPluginFollowsAPhraseChangeForThirtyDays(t *testing.T) {
	n, url, oldSecret := inFortressOnRelay(t)
	p := joinPlugin(t, url, oldSecret)
	p.open(t)
	eventually(t, "the instance to know the plugin's app", func() bool {
		for _, m := range n.fortress(t).Members {
			if m.ID == p.id && m.App == "firesquire" {
				return true
			}
		}
		return false
	})
	// The plugin runs now and then, and is away while the phrase changes.
	p.close()
	before := &plugin{dir: filepath.Join(t.TempDir(), "fortress")}
	if err := os.CopyFS(before.dir, os.DirFS(p.dir)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(before.close)
	words, _ := n.changePhrase(t)
	newSecret, err := phrase.Decode(words)
	if err != nil {
		t.Fatal(err)
	}
	n.server.StopPairing()
	n.server.StartPairing()

	p.open(t)
	eventually(t, "the plugin to follow the new phrase", func() bool {
		followed, err := fortress.Follow(context.Background(), p.dir, p.f)
		if err != nil {
			t.Logf("follow: %v", err)
		}
		return followed
	})
	p.close()
	cfg, err := fortress.Load(p.dir)
	if err != nil {
		t.Fatal(err)
	}
	want := fortress.Domain.Keys(newSecret)
	if cfg.Keys.Group != want.Group || !bytes.Equal(cfg.Keys.Frame, want.Frame) || !bytes.Equal(cfg.Keys.PeerAuth, want.PeerAuth) {
		t.Fatal("the plugin holds other keys than the fortress's under the new phrase")
	}
	p.open(t)
	eventually(t, "the plugin to reach the instance under the new phrase", p.reaches)
	p.close()

	before.open(t)
	eventually(t, "the instance to answer on the old phrase", before.reaches)
	before.close()

	n.server.BackdatePhraseChange(t, 30*24*time.Hour+time.Hour)
	if st := n.server.Pairing.Get(); st.FortressPrevious != nil || st.PairingPrevious != nil {
		t.Fatal("the phrase before is kept 30 days after the change")
	}
	before.open(t)
	time.Sleep(3 * time.Second)
	if before.reaches() {
		t.Error("the instance answers on the old phrase 30 days after the change")
	}
}

func TestTheOldFortressPhraseGoesAfterThirtyDaysWithoutARestart(t *testing.T) {
	n, _, _ := inFortressOnRelay(t)
	n.changePhrase(t)
	n.server.BackdatePhraseChange(t, 30*24*time.Hour-2*time.Second)
	if n.server.Pairing.Get().FortressPrevious == nil {
		t.Fatal("the phrase before went before the 30 days were over")
	}
	eventually(t, "the phrase before to go", func() bool { return n.server.Pairing.Get().FortressPrevious == nil })
	eventually(t, "the fortress to open again", n.server.InFortress)
}
