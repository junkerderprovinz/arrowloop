package web_test

import (
	"net/http"
	"path/filepath"
	"strconv"
	"testing"
	"testing/fstest"

	"github.com/junkerderprovinz/arrowloop/internal/autostart"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// A container has no window, so the routes are not registered and the card is
// left out rather than drawn inert.
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

	// The capabilities say so up front.
	var can struct {
		Window bool `json:"window"`
	}
	getJSON(t, h.srv, "/api/capabilities", &can)
	if can.Window {
		t.Error("a build with no window claims to have one")
	}
}

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

	// The autostart fields are not part of deskset.Settings. Both keys have to
	// be present, since a missing field decodes to false just like autostart
	// being off.
	var raw map[string]any
	getJSON(t, srv, "/api/window", &raw)
	for _, key := range []string{"startWithSystem", "canStartWithSystem"} {
		if _, ok := raw[key]; !ok {
			t.Errorf("the answer carries no %q, so the interface can never draw the switch", key)
		}
	}

	var view struct {
		StartWithSystem    bool `json:"startWithSystem"`
		CanStartWithSystem bool `json:"canStartWithSystem"`
	}
	getJSON(t, srv, "/api/window", &view)
	if view.CanStartWithSystem != autostart.Supported() {
		t.Errorf("the wire says autostart is %v here, the system says %v",
			view.CanStartWithSystem, autostart.Supported())
	}
	on, err := autostart.Enabled()
	if err != nil {
		t.Fatalf("read the autostart entry: %v", err)
	}
	if view.StartWithSystem != on {
		t.Errorf("the wire says autostart is %v, the system itself says %v", view.StartWithSystem, on)
	}

	// The switch is never flipped here: Set registers the running binary, so
	// the test would point the machine's real entry at a temporary executable.
	// That leaves the was != next compare in writeWindow untested, which only
	// saves a needless registry write.
	putJSON(t, srv, "/api/window", `{"tray":true,"closeToTray":true,"minimiseToTray":false,`+
		`"startWithSystem":`+strconv.FormatBool(on)+`}`)
	getJSON(t, srv, "/api/window", &view)
	if view.StartWithSystem != on {
		t.Errorf("saving the other settings moved the autostart switch from %v to %v", on, view.StartWithSystem)
	}
	if after, err := autostart.Enabled(); err != nil || after != on {
		t.Errorf("the system's own entry changed to %v (err %v) with nobody asking", after, err)
	}

	body := `{"tray":true,"closeToTray":true,"minimiseToTray":false}`
	if resp, said := putJSON(t, srv, "/api/window", body); resp.StatusCode != http.StatusOK {
		t.Fatalf("saving: %s %s", resp.Status, said)
	}
	getJSON(t, srv, "/api/window", &got)
	if !got.CloseToTray {
		t.Errorf("the choice was not kept: %+v", got)
	}

	// With no tray icon there is nowhere to send the window, and the answer
	// says what will actually happen.
	putJSON(t, srv, "/api/window", `{"tray":false,"closeToTray":true,"minimiseToTray":true}`)
	getJSON(t, srv, "/api/window", &got)
	if got.CloseToTray || got.MinimiseToTray {
		t.Errorf("the window can be hidden with no way back: %+v", got)
	}
}

// The interface's fallback is right for a reloaded page and wrong under /api,
// where it would tell a client probing for a feature that it exists.
func TestAnUnknownApiAddressIsNotThePage(t *testing.T) {
	h := newHarness(t)
	withUI := &web.Server{
		History: h.history, Runner: h.runner,
		UI:          fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>the app</html>")}},
		Placeholder: []byte("<html>no interface</html>"),
	}
	srv := newServer(t, withUI)

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
