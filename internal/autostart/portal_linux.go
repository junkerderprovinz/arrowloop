package autostart

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/godbus/dbus/v5"
)

// background asks the desktop's Background portal to start the app with the
// session, or to stop doing so, and returns whether it will. The tests stand in
// for the portal here.
var background = portalBackground

// portalWait is how long a request may take. GNOME can ask the person first.
const portalWait = 2 * time.Minute

// portalBackground sends the request on a connection of its own, so the
// answer cannot be taken by anything else listening on the shared one.
func portalBackground(on bool, commandline []string) (bool, error) {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return false, fmt.Errorf("reach the session bus: %w", err)
	}
	defer conn.Close()

	// Subscribed before the call, or a quick answer would go unheard.
	if err := conn.AddMatchSignal(
		dbus.WithMatchInterface("org.freedesktop.portal.Request"),
		dbus.WithMatchMember("Response"),
	); err != nil {
		return false, fmt.Errorf("listen for the portal's answer: %w", err)
	}
	answers := make(chan *dbus.Signal, 4)
	conn.Signal(answers)

	token := "arrowloop" + strconv.FormatInt(time.Now().UnixNano(), 36)
	var handle dbus.ObjectPath
	err = conn.Object("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop").
		Call("org.freedesktop.portal.Background.RequestBackground", 0, "", backgroundOptions(on, commandline, token)).
		Store(&handle)
	if err != nil {
		return false, fmt.Errorf("ask the Background portal: %w", err)
	}

	timeout := time.After(portalWait)
	for {
		select {
		case sig := <-answers:
			if sig.Path != handle || len(sig.Body) < 2 {
				continue
			}
			// Anything but 0 means the person or the desktop said no.
			if code, _ := sig.Body[0].(uint32); code != 0 {
				return false, nil
			}
			results, _ := sig.Body[1].(map[string]dbus.Variant)
			granted, _ := results["autostart"].Value().(bool)
			return granted, nil
		case <-timeout:
			return false, errors.New("the Background portal did not answer")
		}
	}
}

// backgroundOptions is the request's vardict. The command line runs inside the
// sandbox, so it names the program as the manifest installs it.
func backgroundOptions(on bool, commandline []string, token string) map[string]dbus.Variant {
	opts := map[string]dbus.Variant{
		"handle_token": dbus.MakeVariant(token),
		"autostart":    dbus.MakeVariant(on),
	}
	if on {
		opts["commandline"] = dbus.MakeVariant(commandline)
	}
	return opts
}
