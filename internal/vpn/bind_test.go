package vpn

import (
	"errors"
	"syscall"
	"testing"

	"golang.zx2c4.com/wireguard/conn"
)

// refusingBind stands in for a system that does not let the process open what
// WireGuard asks for when it comes up, as Android refuses an app a netlink
// socket.
type refusingBind struct{ conn.Bind }

func (refusingBind) Open(uint16) ([]conn.ReceiveFunc, uint16, error) {
	return nil, 0, syscall.EACCES
}

func TestATunnelThatCannotStartSaysWhyApartFromItsConfig(t *testing.T) {
	defer func(was func() conn.Bind) { openBind = was }(openBind)
	openBind = func() conn.Bind { return refusingBind{conn.NewDefaultBind()} }
	sk, err := GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	tun := New(Options{Logf: t.Logf})
	t.Cleanup(tun.Disconnect)

	err = tun.Connect(dialCtx(t), clientConfig(t, sk, 51820))
	var se *StartError
	if !errors.As(err, &se) || !errors.Is(se.Err, syscall.EACCES) {
		t.Errorf("connect = %v, want a StartError with the system's reason", err)
	}
	if st := tun.State(); st.Err == "" {
		t.Error("the state does not keep the reason")
	}
}

// wireguard-go opens a netlink socket to follow route changes for exactly this
// type, and fails to come up where the system refuses one.
func TestWireGuardFollowsRoutesOnlyWhereTheSystemAllowsIt(t *testing.T) {
	if _, ok := bindFor(false).(*conn.StdNetBind); ok {
		t.Error("a system that refuses a netlink socket gets the bind wireguard-go follows routes for")
	}
}
