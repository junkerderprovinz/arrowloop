package vpn

import (
	"net/netip"
	"strings"
	"testing"
	"time"
)

// A configuration in the shape providers and wg-quick hand out, with what
// wg-quick uses to change the system mixed in.
const providerConf = `# Generated for the home server
[Interface]
PrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=
Address = 10.64.12.3/32, fd00:64::3/128
DNS = 10.64.0.1, home.lan
MTU = 1380
ListenPort = 51820
PostUp = iptables -A FORWARD -i %i -j ACCEPT
Table = off

[Peer]
PublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=
PresharedKey = 4ff3SshWJvhM3cdqXk4ws3pPN7QJgBXZXEx4pMm8kVY=
AllowedIPs = 0.0.0.0/0, ::/0 ; everything
Endpoint = vpn.example.net:51820
PersistentKeepalive = 15
`

func TestAProvidersConfigReadsWithWhatTheSystemWouldUseLeftOut(t *testing.T) {
	c, err := ParseConfig(providerConf)
	if err != nil {
		t.Fatal(err)
	}
	if got := c.PrivateKey.String(); got != "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=" {
		t.Errorf("private key %s", got)
	}
	want := []netip.Prefix{netip.MustParsePrefix("10.64.12.3/32"), netip.MustParsePrefix("fd00:64::3/128")}
	if len(c.Addresses) != 2 || c.Addresses[0] != want[0] || c.Addresses[1] != want[1] {
		t.Errorf("addresses %v, want %v", c.Addresses, want)
	}
	// A search domain on the DNS line means nothing inside the tunnel.
	if len(c.DNS) != 1 || c.DNS[0] != netip.MustParseAddr("10.64.0.1") {
		t.Errorf("name servers %v", c.DNS)
	}
	if c.MTU != 1380 || c.mtu() != 1380 {
		t.Errorf("MTU %d", c.MTU)
	}
	if c.Peer.Endpoint != "vpn.example.net:51820" || c.Peer.PresharedKey.IsZero() {
		t.Errorf("peer %+v", c.Peer)
	}
	if len(c.Peer.AllowedIPs) != 2 {
		t.Errorf("allowed %v", c.Peer.AllowedIPs)
	}
	if c.keepalive() != 15*time.Second {
		t.Errorf("keepalive %v", c.keepalive())
	}
}

func TestABareAddressIsOneHost(t *testing.T) {
	c, err := ParseConfig(strings.Replace(providerConf, "10.64.12.3/32, fd00:64::3/128", "10.64.12.3", 1))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Addresses) != 1 || c.Addresses[0] != netip.MustParsePrefix("10.64.12.3/32") {
		t.Errorf("addresses %v", c.Addresses)
	}
	if c.MTU = 0; c.mtu() != DefaultMTU {
		t.Errorf("default MTU %d", c.mtu())
	}
}

func TestAConfigThatCannotConnectIsRefusedWithItsReason(t *testing.T) {
	cases := []struct {
		name, from, to, says string
	}{
		{"no private key", "PrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\n", "", "no private key"},
		{"a broken key", "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=", "not-a-key", "32 bytes of base64"},
		{"no address", "Address = 10.64.12.3/32, fd00:64::3/128\n", "", "no address"},
		{"no endpoint", "Endpoint = vpn.example.net:51820\n", "", "no endpoint"},
		{"an endpoint without a port", "vpn.example.net:51820", "vpn.example.net", "endpoint"},
		{"port zero", "vpn.example.net:51820", "vpn.example.net:0", "no valid port"},
		{"no allowed addresses", "AllowedIPs = 0.0.0.0/0, ::/0 ; everything\n", "", "allows no addresses"},
		{"an MTU out of range", "MTU = 1380", "MTU = 100", "out of range"},
		{"a second peer", "PersistentKeepalive = 15\n", "PersistentKeepalive = 15\n[Peer]\nPublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\n", "only one [Peer]"},
		{"a line that is not key = value", "Table = off", "Table off", "not key = value"},
		{"a key outside a section", "# Generated for the home server", "Address = 10.0.0.1", "outside a section"},
	}
	for _, c := range cases {
		text := strings.Replace(providerConf, c.from, c.to, 1)
		if text == providerConf {
			t.Fatalf("%s: the case changes nothing", c.name)
		}
		_, err := ParseConfig(text)
		if err == nil || !strings.Contains(err.Error(), c.says) {
			t.Errorf("%s: %v, want it to say %q", c.name, err, c.says)
		}
	}
}

func TestAConfigWithoutKeepaliveStillKeepsTheHandshakeFresh(t *testing.T) {
	c, err := ParseConfig(strings.Replace(providerConf, "PersistentKeepalive = 15", "PersistentKeepalive = off", 1))
	if err != nil {
		t.Fatal(err)
	}
	if c.keepalive() != DefaultKeepalive {
		t.Errorf("keepalive %v, want %v", c.keepalive(), DefaultKeepalive)
	}
	if !strings.Contains(c.uapi(netip.MustParseAddrPort("192.0.2.1:51820")), "persistent_keepalive_interval=25\n") {
		t.Error("the device is not told to keep the handshake fresh")
	}
}
