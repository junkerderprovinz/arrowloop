package web_test

import (
	"net/http"
	"testing"
)

func TestAnInstanceThatLeavesIsGoneFromTheOtherMembers(t *testing.T) {
	url := testRelay(t)
	words := newWords(t)
	a, b := newNode(t, url), newNode(t, url)
	a.join(t, words)
	b.join(t, words)
	eventually(t, "the two to meet", func() bool { return len(b.fortress(t).Members) == 1 })

	if status, body := a.send(t, http.MethodDelete, "/api/fortress", ""); status != http.StatusOK {
		t.Fatalf("leave = %d %s", status, body)
	}
	if got := b.fortress(t).Members; len(got) != 0 {
		t.Errorf("the other instance still lists %+v after it left", got)
	}
}
