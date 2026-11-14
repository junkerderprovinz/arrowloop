package web_test

import (
	"context"
	"fmt"
	"runtime"
	"testing"
	"time"
)

// With one run at a time, a job started while another runs waits for it, and
// the list says so rather than calling it running like the other.
func TestTheJobListSaysARunWaitsForItsTurn(t *testing.T) {
	pause := "sleep 5"
	if runtime.GOOS == "windows" {
		pause = "ping -n 6 127.0.0.1 > nul"
	}
	h := engineFor(t, fmt.Sprintf(`{"parallelJobs":1,"jobs":[
		{"name":"slow","left":"%%[1]s/left","right":"%%[1]s/right","state":"%%[1]s/slow.db","before":%q},
		{"name":"quick","left":"%%[1]s/left","right":"%%[1]s/right","state":"%%[1]s/quick.db"}]}`, pause))

	ctx, stop := context.WithCancel(context.Background())
	done := make(chan struct{}, 2)
	for _, name := range []string{"slow", "quick"} {
		go func() {
			_, _ = h.runner.Run(ctx, name)
			done <- struct{}{}
		}()
		deadline := time.Now().Add(5 * time.Second)
		// The slow job has to hold the one slot before the quick one asks.
		for !h.runner.Running()[name] || name == "slow" && h.runner.Queued()[name] {
			if time.Now().After(deadline) {
				t.Fatalf("%s never started", name)
			}
			time.Sleep(5 * time.Millisecond)
		}
	}
	t.Cleanup(func() {
		stop()
		<-done
		<-done
	})

	var jobs []struct {
		Name    string `json:"name"`
		Running bool   `json:"running"`
		Queued  bool   `json:"queued"`
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		h.get(t, "/api/jobs", &jobs)
		if len(jobs) == 2 && jobs[0].Queued != jobs[1].Queued {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the list never told the two runs apart: %+v", jobs)
		}
		time.Sleep(10 * time.Millisecond)
	}
	for _, j := range jobs {
		if !j.Running {
			t.Errorf("%s is not listed as running", j.Name)
		}
		if j.Queued != (j.Name == "quick") {
			t.Errorf("%s is listed with queued %v", j.Name, j.Queued)
		}
	}
}
