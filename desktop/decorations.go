package main

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path"
	"strings"
	"time"
)

// GTK 3 binds KDE's decoration manager wherever a compositor offers it and asks
// it to decorate every window GTK does not decorate itself, a frameless one
// included. KWin then draws its title bar over the page's own (#240).
const decorationManager = "org_kde_kwin_server_decoration_manager"

// systemDecorates reports whether the window manager puts its title bar on a
// frameless window, by asking the compositor GTK will draw on.
func systemDecorates() bool {
	socket, ok := gdkWaylandSocket(os.Getenv)
	if !ok {
		return false
	}
	conn, err := net.DialTimeout("unix", socket, time.Second)
	if err != nil {
		log.Printf("could not ask the compositor about title bars: %v", err)
		return false
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(time.Second))
	offered, err := offersServerDecorations(conn)
	if err != nil {
		log.Printf("could not ask the compositor about title bars: %v", err)
	}
	return offered
}

// gdkWaylandSocket returns the compositor socket GDK will draw through, and
// false where it will draw through X11. A socket handed over as a file
// descriptor is GDK's alone to read.
func gdkWaylandSocket(getenv func(string) string) (string, bool) {
	if backends := getenv("GDK_BACKEND"); backends != "" {
		first, _, _ := strings.Cut(backends, ",")
		if first = strings.TrimSpace(first); first != "wayland" && first != "*" {
			return "", false
		}
	}
	if getenv("WAYLAND_SOCKET") != "" {
		return "", false
	}
	name := getenv("WAYLAND_DISPLAY")
	if name == "" {
		name = "wayland-0"
	}
	if path.IsAbs(name) {
		return name, true
	}
	dir := getenv("XDG_RUNTIME_DIR")
	if dir == "" {
		return "", false
	}
	return path.Join(dir, name), true
}

// The objects of the conversation: the display exists from the start, the
// other two are the client's to number.
const (
	wlDisplay  = 1
	wlRegistry = 2
	wlCallback = 3
)

// offersServerDecorations reads the globals a Wayland compositor announces.
// The reply to a sync sent after asking for the registry marks the end of
// them.
func offersServerDecorations(conn io.ReadWriter) (bool, error) {
	var req []byte
	req = waylandRequest(req, wlDisplay, 1, wlRegistry) // get_registry
	req = waylandRequest(req, wlDisplay, 0, wlCallback) // sync
	if _, err := conn.Write(req); err != nil {
		return false, err
	}

	offered := false
	r := bufio.NewReader(conn)
	head := make([]byte, 8)
	for {
		if _, err := io.ReadFull(r, head); err != nil {
			return false, err
		}
		sender := binary.NativeEndian.Uint32(head)
		word := binary.NativeEndian.Uint32(head[4:])
		size, opcode := word>>16, word&0xffff
		if size < 8 {
			return false, fmt.Errorf("an event %d bytes long", size)
		}
		body := make([]byte, size-8)
		if _, err := io.ReadFull(r, body); err != nil {
			return false, err
		}
		switch {
		case sender == wlCallback:
			return offered, nil
		case sender == wlDisplay && opcode == 0:
			return false, errors.New("the compositor reported an error")
		case sender == wlRegistry && opcode == 0 && len(body) >= 8:
			// global: a number, the interface's name, its version.
			n := binary.NativeEndian.Uint32(body[4:])
			if n > 0 && uint64(n) <= uint64(len(body)-8) && string(body[8:8+n-1]) == decorationManager {
				offered = true
			}
		}
	}
}

// waylandRequest appends a request that carries one number, in the byte order
// of the machine, as Wayland's wire format has it.
func waylandRequest(buf []byte, object uint32, opcode uint16, arg uint32) []byte {
	buf = binary.NativeEndian.AppendUint32(buf, object)
	buf = binary.NativeEndian.AppendUint32(buf, 12<<16|uint32(opcode))
	return binary.NativeEndian.AppendUint32(buf, arg)
}
