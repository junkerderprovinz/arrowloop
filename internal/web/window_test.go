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

	// The autostart pair, which this test used to decode straight past.
	//
	// It read the answer into deskset.Settings, and those two fields are not on
	// deskset.Settings: they are added by the handler's own view, because one of
	// them lives in the operating system rather than in the file. So the switch
	// could have been renamed, dropped from the JSON, or served as a constant
	// false, and every test here would still have passed while the card quietly
	// stopped being drawn. Decoding into the shape the interface actually reads
	// is the whole point.
	// Both keys have to BE there, checked before their values are looked at.
	//
	// Comparing values alone does not do it: a machine whose autostart is off
	// answers false, a field that has been renamed or dropped decodes to false as
	// well, and the two are indistinguishable. The rename really did slip past an
	// earlier version of this test for exactly that reason. So the raw object is
	// read first and asked which keys it carries.
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

	// Saving without touching the switch must leave it exactly where it was, and
	// must still answer with it. Nothing here ever flips it on purpose: Set
	// registers whatever binary is running, so a test that turned it on would
	// point the machine's real ArrowLoop entry at a temporary test executable and
	// would overwrite the setting of whoever ran the tests. Worse, it could not
	// put it back: Set registers the running binary, so restoring would re-point
	// a real entry at the test's temporary path.
	//
	// What that leaves uncovered, said plainly rather than left to be assumed:
	// the `was != next` compare in writeWindow is NOT reached by this test.
	// Inverting it still passes here, because the write it then performs asks the
	// system for the state it is already in, and removing an entry that does not
	// exist succeeds silently. The compare saves a needless registry write; it is
	// not what keeps the setting correct. What this test does cover is that the
	// two fields reach the wire under the names the interface reads, that they
	// report the system rather than a stored copy, and that saving the window
	// settings never moves the switch as a side effect.
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
