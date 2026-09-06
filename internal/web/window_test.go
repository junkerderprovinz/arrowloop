package web_test

import (
	"net/http"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/junkerderprovinz/arrowloop/internal/deskset"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// TestAContainerHasNoWindowSettings.
//
// A container has no title bar and no notification area. Serving it a card
// about what the close button does would be serving a control that is present
// and inert, and somebody will change it and expect something. The routes are
// simply not registered, and the interface asks once and leaves the card out.
func TestAContainerHasNoWindowSettings(t *testing.T) {
	h := newHarness(t)
	resp, err := h.srv.Client().Get(h.srv.URL + "/api/window")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Error("a build with no window answered a question about its window")
	}

	// And it says so before being asked, so the interface never has to learn it
	// from a failed request. Every build answers this, including the ones that
	// can do the least.
	var can struct {
		Window bool `json:"window"`
	}
	getJSON(t, h.srv, "/api/capabilities", &can)
	if can.Window {
		t.Error("a build with no window claims to have one")
	}
}

// TestADesktopBuildAnswersAndRemembers.
func TestADesktopBuildAnswersAndRemembers(t *testing.T) {
	h := newHarness(t)
	store := deskset.Open(filepath.Join(t.TempDir(), "arrowloop.json"))
	desktop := &web.Server{History: h.history, Runner: h.runner, Window: store}
	srv := newServer(t, desktop)

	var can struct {
		Window bool `json:"window"`
	}
	getJSON(t, srv, "/api/capabilities", &can)
	if !can.Window {
		t.Error("a desktop build does not admit to having a window")
	}

	var got deskset.Settings
	getJSON(t, srv, "/api/window", &got)
	if got != deskset.Default() {
		t.Errorf("a fresh desktop build did not answer with the default: %+v", got)
	}

	body := `{"tray":true,"closeToTray":true,"minimiseToTray":false}`
	if resp, said := putJSON(t, srv, "/api/window", body); resp.StatusCode != http.StatusOK {
		t.Fatalf("saving: %s %s", resp.Status, said)
	}
	getJSON(t, srv, "/api/window", &got)
	if !got.CloseToTray {
		t.Errorf("the choice was not kept: %+v", got)
	}

	// And the store's own rule reaches the wire: with no icon there is nowhere
	// to send the window, so what comes back is what will actually happen
	// rather than what was asked for.
	putJSON(t, srv, "/api/window", `{"tray":false,"closeToTray":true,"minimiseToTray":true}`)
	getJSON(t, srv, "/api/window", &got)
	if got.CloseToTray || got.MinimiseToTray {
		t.Errorf("the window can be hidden with no way back: %+v", got)
	}
}

// TestAnUnknownApiAddressIsNotThePage.
//
// The interface's own fallback answers anything the routes do not, which is
// right for a page somebody reloaded and wrong for an address under /api: a
// client asking whether a feature exists would be told yes, with a 200, and
// handed a web page. The window settings were reachable that way on a build
// that has no window, and nothing broke only because the client happened to
// fail on the parse rather than on the status.
func TestAnUnknownApiAddressIsNotThePage(t *testing.T) {
	h := newHarness(t)
	withUI := &web.Server{
		History: h.history, Runner: h.runner,
		UI:          fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>the app</html>")}},
		Placeholder: []byte("<html>no interface</html>"),
	}
	srv := newServer(t, withUI)

	// The page itself still answers, which is what the fallback is for.
	if resp, err := srv.Client().Get(srv.URL + "/some/deep/route"); err != nil {
		t.Fatalf("GET: %v", err)
	} else {
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("a reloaded page answered %s", resp.Status)
		}
	}

	for _, path := range []string{"/api/window", "/api/nothing-here", "/api/"} {
		resp, err := srv.Client().Get(srv.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s answered %s rather than saying there is no such address", path, resp.Status)
		}
	}
}
