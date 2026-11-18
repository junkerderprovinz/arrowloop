package main

import (
	"encoding/binary"
	"io"
	"net"
	"testing"
)

// compositor answers the two requests a client opens with, the registry and a
// sync, the way a Wayland compositor does: one event per global, then the
// callback's done.
func compositor(t *testing.T, conn net.Conn, globals ...string) {
	t.Helper()
	defer conn.Close()
	req := make([]byte, 24)
	if _, err := io.ReadFull(conn, req); err != nil {
		t.Errorf("read the requests: %v", err)
		return
	}
	want := []uint32{1, 12<<16 | 1, 2, 1, 12 << 16, 3}
	for i, w := range want {
		if got := binary.NativeEndian.Uint32(req[i*4:]); got != w {
			t.Errorf("word %d of the requests is %#x, want %#x", i, got, w)
		}
	}
	var out []byte
	for i, name := range globals {
		body := binary.NativeEndian.AppendUint32(nil, uint32(i+1))
		body = binary.NativeEndian.AppendUint32(body, uint32(len(name)+1))
		body = append(body, name...)
		body = append(body, 0)
		for len(body)%4 != 0 {
			body = append(body, 0)
		}
		body = binary.NativeEndian.AppendUint32(body, 1)
		out = event(out, 2, 0, body)
	}
	out = event(out, 3, 0, binary.NativeEndian.AppendUint32(nil, 1))
	_, _ = conn.Write(out)
}

func event(out []byte, sender uint32, opcode uint16, body []byte) []byte {
	out = binary.NativeEndian.AppendUint32(out, sender)
	out = binary.NativeEndian.AppendUint32(out, uint32(8+len(body))<<16|uint32(opcode))
	return append(out, body...)
}

func offers(t *testing.T, globals ...string) bool {
	t.Helper()
	client, server := net.Pipe()
	defer client.Close()
	go compositor(t, server, globals...)
	got, err := offersServerDecorations(client)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestKWinDecoratesAWindowGTKLeavesBare(t *testing.T) {
	if !offers(t, "wl_compositor", "xdg_wm_base", "org_kde_kwin_server_decoration_manager", "zxdg_decoration_manager_v1") {
		t.Error("KWin's decoration manager went unnoticed")
	}
}

func TestMutterLeavesTheFrameToTheWindow(t *testing.T) {
	if offers(t, "wl_compositor", "xdg_wm_base", "gtk_shell1", "zxdg_output_manager_v1") {
		t.Error("a compositor without KDE's decoration manager was taken to draw a title bar")
	}
}

func TestAnErrorFromTheCompositorIsNoAnswer(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	go func() {
		defer server.Close()
		_, _ = io.ReadFull(server, make([]byte, 24))
		msg := []byte("invalid object 2\x00\x00\x00\x00")
		body := binary.NativeEndian.AppendUint32(nil, 1)
		body = binary.NativeEndian.AppendUint32(body, 0)
		body = binary.NativeEndian.AppendUint32(body, 17)
		_, _ = server.Write(event(nil, 1, 0, append(body, msg...)))
	}()
	if _, err := offersServerDecorations(client); err == nil {
		t.Error("an error event was read as a list of globals")
	}
}

func TestACompositorThatHangsUpIsNoAnswer(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	go func() {
		_, _ = io.ReadFull(server, make([]byte, 24))
		server.Close()
	}()
	if _, err := offersServerDecorations(client); err == nil {
		t.Error("a closed connection was read as a list of globals")
	}
}

func TestGDKDrawsOnWaylandWhereItCan(t *testing.T) {
	for _, tc := range []struct {
		name string
		env  map[string]string
		want string
	}{
		{"a Wayland session", map[string]string{"WAYLAND_DISPLAY": "wayland-0", "XDG_RUNTIME_DIR": "/run/user/1000"}, "/run/user/1000/wayland-0"},
		{"the default display name", map[string]string{"XDG_RUNTIME_DIR": "/run/user/1000"}, "/run/user/1000/wayland-0"},
		{"a display given by its path", map[string]string{"WAYLAND_DISPLAY": "/tmp/wl"}, "/tmp/wl"},
		{"Wayland asked for first", map[string]string{"GDK_BACKEND": "wayland,x11", "WAYLAND_DISPLAY": "wayland-1", "XDG_RUNTIME_DIR": "/run/user/1000"}, "/run/user/1000/wayland-1"},
		{"any backend", map[string]string{"GDK_BACKEND": "*", "WAYLAND_DISPLAY": "wayland-0", "XDG_RUNTIME_DIR": "/run/user/1000"}, "/run/user/1000/wayland-0"},
		{"X11 asked for", map[string]string{"GDK_BACKEND": "x11", "WAYLAND_DISPLAY": "wayland-0", "XDG_RUNTIME_DIR": "/run/user/1000"}, ""},
		{"X11 asked for first", map[string]string{"GDK_BACKEND": "x11,wayland", "WAYLAND_DISPLAY": "wayland-0", "XDG_RUNTIME_DIR": "/run/user/1000"}, ""},
		{"no runtime directory", map[string]string{"WAYLAND_DISPLAY": "wayland-0"}, ""},
		{"a socket handed over", map[string]string{"WAYLAND_SOCKET": "3", "XDG_RUNTIME_DIR": "/run/user/1000"}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := gdkWaylandSocket(func(k string) string { return tc.env[k] })
			if got != tc.want || ok != (tc.want != "") {
				t.Errorf("got %q, %v, want %q", got, ok, tc.want)
			}
		})
	}
}

func TestTheShellTellsThePageWhoDrawsTheTitleBar(t *testing.T) {
	if got := pageURL("", "de", true); got != "/?frame=system&lang=de" {
		t.Errorf("with the system's title bar the main window opens %q", got)
	}
	if got := pageURL("", "", false); got != "/" {
		t.Errorf("with its own title bar the main window opens %q", got)
	}
}
