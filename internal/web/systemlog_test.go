package web_test

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

func TestTheSystemLogIsListedNewestFirst(t *testing.T) {
	h := engineFor(t, `{"jobs":[]}`)
	at := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	if err := h.history.AddSystemLog(context.Background(), []history.SystemLine{
		{At: at, Source: "rclone", Text: "Failed to copy: disk full"},
		{At: at.Add(time.Minute), Source: "integration", Text: "fortress: could not join the fortress"},
		{At: at.Add(2 * time.Minute), Source: "connection", Text: "nas: no such host"},
	}); err != nil {
		t.Fatalf("add: %v", err)
	}

	var got []struct {
		Source, Text string
		At           time.Time
		Count        int
	}
	h.get(t, "/api/system-log?limit=2", &got)
	if len(got) != 2 || got[0].Source != "connection" || got[1].Source != "integration" || got[0].Count != 1 || !got[0].At.Equal(at.Add(2*time.Minute)) {
		t.Errorf("listed %+v, want the two newest lines", got)
	}
}

func TestAnEmptySystemLogIsAnEmptyList(t *testing.T) {
	h := engineFor(t, `{"jobs":[]}`)
	var got []any
	h.get(t, "/api/system-log", &got)
	if got == nil || len(got) != 0 {
		t.Errorf("listed %#v, want an empty list", got)
	}
}
