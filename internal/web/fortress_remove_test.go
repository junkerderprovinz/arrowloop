package web_test

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"
)

type removedMember struct {
	App    string `json:"app"`
	Name   string `json:"name"`
	Device string `json:"device"`
}

type removedView struct {
	Joined      bool            `json:"joined"`
	Removed     []removedMember `json:"removed"`
	RemovedHere bool            `json:"removedHere"`
}

func (n *node) removedView(t *testing.T) removedView {
	t.Helper()
	var v removedView
	n.get(t, "/api/fortress", &v)
	return v
}

// restart stands n up again from what it keeps on disk, as a new start of the
// container does.
func (n *node) restart(t *testing.T, relayURL string) *node {
	t.Helper()
	n.server.StopPairing()
	n.srv.Close()
	return nodeWith(t, setup{relay: relayURL}, n.harness)
}

// arrowLoopIn is the id the plugin knows the instance by.
func arrowLoopIn(t *testing.T, p *plugin) string {
	t.Helper()
	var id string
	eventually(t, "the plugin to know the instance", func() bool {
		for _, m := range p.f.Members() {
			if m.App.ID == "arrowloop" {
				id = m.ID
				return true
			}
		}
		return false
	})
	return id
}

func TestARemovedMemberStaysNamedAndOutUntilThePhraseChanges(t *testing.T) {
	n, url, sec := inFortressOnRelay(t)
	p := joinPlugin(t, url, sec)
	p.open(t)
	eventually(t, "the instance to know the plugin's app", func() bool {
		for _, m := range n.fortress(t).Members {
			if m.ID == p.id && m.App == "firesquire" {
				return true
			}
		}
		return false
	})
	own := arrowLoopIn(t, p)

	status, body := n.send(t, http.MethodDelete, "/api/fortress/members/"+p.id, "")
	if status != http.StatusOK {
		t.Fatalf("remove = %d %s", status, body)
	}
	var v removedView
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatal(err)
	}
	want := []removedMember{{App: "firesquire", Name: "firesquire", Device: "tower"}}
	if !slices.Equal(v.Removed, want) {
		t.Fatalf("removed = %+v", v.Removed)
	}

	n = n.restart(t, url)
	if got := n.removedView(t).Removed; !slices.Equal(got, want) {
		t.Fatalf("removed after a restart = %+v", got)
	}
	time.Sleep(3 * time.Second)
	for _, m := range n.fortress(t).Members {
		if m.ID == p.id {
			t.Fatal("the removed plugin is a member again after a restart")
		}
	}
	if _, err := p.f.Status(context.Background(), own, "en"); err == nil {
		t.Fatal("the instance answers the removed plugin after a restart")
	}

	n.changePhrase(t)
	if got := n.removedView(t).Removed; len(got) != 0 {
		t.Fatalf("still named after the phrase changed: %+v", got)
	}
}

func TestOnlyAnotherMemberIsRemoved(t *testing.T) {
	a := newNode(t, testRelay(t))
	status, body := a.send(t, http.MethodDelete, "/api/fortress/members/abc", "")
	if status != http.StatusConflict || !strings.Contains(string(body), `"noFortress"`) {
		t.Fatalf("removing outside a fortress = %d %s", status, body)
	}

	n, url, sec := inFortressOnRelay(t)
	p := joinPlugin(t, url, sec)
	p.open(t)
	own := arrowLoopIn(t, p)
	for _, id := range []string{own, "nobody"} {
		status, body := n.send(t, http.MethodDelete, "/api/fortress/members/"+id, "")
		if status != http.StatusNotFound || !strings.Contains(string(body), `"noMember"`) {
			t.Errorf("removing %s = %d %s", id, status, body)
		}
	}
	if v := n.removedView(t); !v.Joined || v.RemovedHere || v.Removed == nil || len(v.Removed) != 0 {
		t.Fatalf("view = %+v", v)
	}
}

func TestAnInstanceTakenOutSaysSoUntilItJoinsAgain(t *testing.T) {
	n, url, sec := inFortressOnRelay(t)
	p := joinPlugin(t, url, sec)
	p.open(t)
	own := arrowLoopIn(t, p)
	words := n.shownPhrase(t)
	if err := p.f.Remove(own); err != nil {
		t.Fatal(err)
	}
	eventually(t, "the instance to say another member took it out", func() bool {
		v := n.removedView(t)
		return !v.Joined && v.RemovedHere
	})

	n = n.restart(t, url)
	if v := n.removedView(t); v.Joined || !v.RemovedHere {
		t.Fatalf("after a restart = %+v", v)
	}
	n.join(t, words)
	if v := n.removedView(t); !v.Joined || v.RemovedHere {
		t.Fatalf("after joining again = %+v", v)
	}
}
