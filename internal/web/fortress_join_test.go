package web_test

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/fortress"
	"github.com/junkerderprovinz/parleyport/kit/phrase"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

type fortressInfo struct {
	Joined  bool   `json:"joined"`
	Phrase  bool   `json:"phrase"`
	Device  string `json:"device"`
	Members []struct {
		ID     string `json:"id"`
		App    string `json:"app"`
		Device string `json:"device"`
		Online bool   `json:"online"`
	} `json:"members"`
}

func (n *node) fortress(t *testing.T) fortressInfo {
	t.Helper()
	var v fortressInfo
	n.get(t, "/api/fortress", &v)
	return v
}

func (n *node) shownPhrase(t *testing.T) string {
	t.Helper()
	status, body := n.send(t, http.MethodPost, "/api/fortress/phrase/show", `{}`)
	if status != http.StatusOK {
		t.Fatalf("show the phrase = %d %s", status, body)
	}
	var out struct{ Phrase string }
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	return out.Phrase
}

func newWords(t *testing.T) string {
	t.Helper()
	_, words, err := phrase.New()
	if err != nil {
		t.Fatal(err)
	}
	return words
}

func (n *node) join(t *testing.T, words string) {
	t.Helper()
	if status, body := n.send(t, http.MethodPost, "/api/fortress/join", `{"phrase":"`+words+`"}`); status != http.StatusOK {
		t.Fatalf("join the fortress = %d %s", status, body)
	}
}

// approvedIn reports whether n's pairing lists id as approved.
func (n *node) approvedIn(t *testing.T, id string) bool {
	t.Helper()
	for _, m := range n.connect(t).Members {
		if m.ID == id && m.Approved {
			return true
		}
	}
	return false
}

func TestJoiningTheFortressTakesThePairedInstancesAlong(t *testing.T) {
	url := testRelay(t)
	a, b := newNode(t, url), newNode(t, url)
	aID, bID := pair(t, a, b)
	words := newWords(t)
	a.join(t, words)

	eventually(t, "the paired instance to follow into the fortress", func() bool { return b.fortress(t).Joined })
	if got := b.shownPhrase(t); got != words {
		t.Errorf("the instance that followed holds %q, want the fortress phrase", got)
	}
	eventually(t, "both to see each other in the fortress", func() bool {
		return slices.ContainsFunc(a.fortress(t).Members, func(m struct {
			ID     string `json:"id"`
			App    string `json:"app"`
			Device string `json:"device"`
			Online bool   `json:"online"`
		}) bool {
			return m.ID == bID && m.App == "arrowloop"
		})
	})
	eventually(t, "the pairing to stay approved on both sides", func() bool {
		return a.approvedIn(t, bID) && b.approvedIn(t, aID) && len(a.connect(t).Pending) == 0 && len(b.connect(t).Pending) == 0
	})

	// Another app with the phrase meets this one there and lists its jobs.
	secret, err := phrase.Decode(words)
	if err != nil {
		t.Fatal(err)
	}
	loader, _ := openFortress(t, url, nil, "knightloader", "Attic", func(c *fortress.Config) {
		c.Secret = secret
		c.Uses = []string{"jobs.list"}
	})
	knows(t, loader, aID, "arrowloop")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, err := loader.Act(ctx, aID, "jobs.list", nil); err != nil {
		t.Errorf("another app lists the jobs: %v", err)
	}
}

func TestAnInstanceThatWasAwayFollowsOnceItIsBack(t *testing.T) {
	web.ShortenMoveWait(t, 200*time.Millisecond)
	url := testRelay(t)
	a, b := newNode(t, url), newNode(t, url)
	pair(t, a, b)
	b.server.StopPairing()
	a.join(t, newWords(t))
	if b.fortress(t).Joined {
		t.Fatal("an instance that was away joined the fortress")
	}
	b.server.StartPairing()
	eventually(t, "the instance that was away to follow", func() bool { return b.fortress(t).Joined })
}

func TestTheFortressPhraseIsShownAgainAndAChangeReachesTheOthers(t *testing.T) {
	url := testRelay(t)
	a, b := newNode(t, url), newNode(t, url)
	pair(t, a, b)
	words := newWords(t)
	a.join(t, words)
	eventually(t, "the paired instance to follow", func() bool { return b.fortress(t).Joined })
	if got := a.shownPhrase(t); got != words {
		t.Fatalf("the phrase is shown as %q, want the one entered", got)
	}

	status, body := a.send(t, http.MethodPost, "/api/fortress/phrase", `{}`)
	if status != http.StatusOK {
		t.Fatalf("change the phrase = %d %s", status, body)
	}
	var changed struct {
		Phrase string   `json:"phrase"`
		Left   []string `json:"left"`
	}
	if err := json.Unmarshal(body, &changed); err != nil || changed.Phrase == words || changed.Phrase == "" {
		t.Fatalf("the change answered %s", body)
	}
	if got := a.shownPhrase(t); got != changed.Phrase {
		t.Errorf("after the change the phrase is shown as %q", got)
	}
	eventually(t, "the other instance to take the new phrase", func() bool { return b.shownPhrase(t) == changed.Phrase })
}

func TestLeavingTheFortressLeavesItAll(t *testing.T) {
	url := testRelay(t)
	a := newNode(t, url)
	a.join(t, newWords(t))
	if !a.fortress(t).Joined || !a.connect(t).Active {
		t.Fatal("after joining the instance is in no fortress")
	}
	if status, body := a.send(t, http.MethodDelete, "/api/fortress", ""); status != http.StatusOK {
		t.Fatalf("leave = %d %s", status, body)
	}
	if a.fortress(t).Joined || a.connect(t).Active {
		t.Error("after leaving the instance is still in the fortress or a group")
	}
}

func TestAJoinIsRefusedWithItsReason(t *testing.T) {
	a := newNode(t, testRelay(t))
	status, body := a.send(t, http.MethodPost, "/api/fortress/join", `{"phrase":"apple banana"}`)
	var refused struct{ Code string }
	_ = json.Unmarshal(body, &refused)
	if status != http.StatusBadRequest || refused.Code != string(phrase.ReasonWordCount) {
		t.Errorf("two words = %d %s, want the word count named", status, body)
	}
	a.join(t, newWords(t))
	status, body = a.send(t, http.MethodPost, "/api/fortress/join", `{"phrase":"`+newWords(t)+`"}`)
	_ = json.Unmarshal(body, &refused)
	if status != http.StatusConflict || refused.Code != "inFortress" {
		t.Errorf("a second fortress = %d %s, want inFortress", status, body)
	}
}
