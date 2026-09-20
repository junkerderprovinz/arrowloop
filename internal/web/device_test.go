package web_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/hold"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// deviceServer is a server with a hold store, as the phone build has.
func deviceServer(t *testing.T) (*httptest.Server, *hold.Store) {
	t.Helper()
	h := newHarness(t)
	held := hold.New()
	s := &web.Server{History: h.history, Runner: h.runner, Hold: held}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return srv, held
}

func TestWithoutAHoldStoreThereIsNoDeviceRoute(t *testing.T) {
	h := newHarness(t)
	resp, err := h.srv.Client().Get(h.srv.URL + "/api/device")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	// 404 rather than the interface's HTML with a 200.
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("a build with nothing to report to answered /api/device with %s", resp.Status)
	}
}

func TestAReportReachesTheConditionThatHoldsRuns(t *testing.T) {
	srv, held := deviceServer(t)

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/device",
		strings.NewReader(`{"reason":"this phone is on battery"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("PUT: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT /api/device: %s", resp.Status)
	}

	// What was posted has to reach the condition the runner asks, not only
	// the endpoint that reads it back.
	if err := held.Condition()(context.Background(), job.Job{Name: "photos"}); err == nil {
		t.Fatal("a reported reason did not reach the condition")
	}

	var state hold.State
	resp2, err := srv.Client().Get(srv.URL + "/api/device")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp2.Body.Close()
	if err := json.NewDecoder(resp2.Body).Decode(&state); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if state.Reason != "this phone is on battery" {
		t.Fatalf("the reason read back wrong: %+v", state)
	}
}

func TestCapabilitiesSayWhetherAnythingCanReport(t *testing.T) {
	h := newHarness(t)
	var plain map[string]any
	h.get(t, "/api/capabilities", &plain)
	if plain["device"] != false {
		t.Fatalf("a container claimed something could report to it: %v", plain["device"])
	}

	srv, _ := deviceServer(t)
	resp, err := srv.Client().Get(srv.URL + "/api/capabilities")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	var phone map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&phone); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if phone["device"] != true {
		t.Fatalf("a build with a hold store denied it: %v", phone["device"])
	}
}
