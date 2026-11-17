package vpnconn

import "context"

// Provider is one tile of the VPN settings: what its form asks for and how
// ArrowLoop connects to it.
type Provider struct {
	ID     string
	Name   string
	Fields []string

	open opener
	// forget gives back what open registered with the provider, when the
	// login is deleted.
	forget func(ctx context.Context, login Login)
}

// Custom is the tile for a WireGuard configuration of one's own, such as the
// one a router at home hands out.
const Custom = "custom"

// catalogue is the provider list of web/src/lib/vpn.ts, in its order; a test
// holds the two together.
func catalogue() []Provider {
	conf, hide := opener(openConfig), opener(openHideMe)
	return []Provider{
		{ID: "nordvpn", Name: "NordVPN", Fields: []string{"token", "location"}, open: openNordVPN},
		{ID: "protonvpn", Name: "Proton VPN", Fields: []string{"config"}, open: conf},
		{ID: "surfshark", Name: "Surfshark", Fields: []string{"config"}, open: conf},
		{ID: "pia", Name: "Private Internet Access", Fields: []string{"username", "password", "location"}, open: openPIA},
		{ID: "mullvad", Name: "Mullvad VPN", Fields: []string{"accountNumber", "location"}, open: openMullvad, forget: forgetMullvad},
		{ID: "windscribe", Name: "Windscribe", Fields: []string{"config"}, open: conf},
		{ID: "ipvanish", Name: "IPVanish", Fields: []string{"config"}, open: conf},
		{ID: "purevpn", Name: "PureVPN", Fields: []string{"config"}, open: conf},
		{ID: "hideme", Name: "hide.me", Fields: []string{"username", "password", "location"}, open: hide},
		{ID: "airvpn", Name: "AirVPN", Fields: []string{"config"}, open: conf},
		{ID: "ivpn", Name: "IVPN", Fields: []string{"config"}, open: conf},
		{ID: "torguard", Name: "TorGuard", Fields: []string{"username", "password", "location"}, open: openTorGuard},
		{ID: "privadovpn", Name: "PrivadoVPN", Fields: []string{"config"}, open: conf},
		{ID: "ovpn", Name: "OVPN", Fields: []string{"config"}, open: conf},
		{ID: "azirevpn", Name: "AzireVPN", Fields: []string{"username", "password", "location"}, open: openAzire, forget: forgetAzire},
		{ID: "fastestvpn", Name: "FastestVPN", Fields: []string{"config"}, open: conf},
		{ID: "ivacy", Name: "Ivacy VPN", Fields: []string{"config"}, open: conf},
		{ID: "privatevpn", Name: "PrivateVPN", Fields: []string{"config"}, open: conf},
		{ID: "astrill", Name: "Astrill VPN", Fields: []string{"config"}, open: conf},
		{ID: "zoogvpn", Name: "ZoogVPN", Fields: []string{"config"}, open: conf},
		{ID: "cryptostorm", Name: "cryptostorm", Fields: []string{"config"}, open: conf},
		{ID: "strongvpn", Name: "StrongVPN", Fields: []string{"config"}, open: conf},
		{ID: "vpnunlimited", Name: "VPN Unlimited", Fields: []string{"config"}, open: conf},
		{ID: "kaspersky", Name: "Kaspersky VPN", Fields: []string{"config"}, open: conf},
		{ID: "anonine", Name: "Anonine", Fields: []string{"config"}, open: conf},
		{ID: "njalla", Name: "Njalla VPN", Fields: []string{"config"}, open: conf},
		{ID: "trustzone", Name: "Trust.Zone", Fields: []string{"config"}, open: conf},
		{ID: "obscura", Name: "Obscura VPN", Fields: []string{"accountNumber", "location"}, open: openObscura, forget: forgetObscura},
		{ID: "levpn", Name: "Le VPN", Fields: []string{"config"}, open: conf},
		{ID: "xeovo", Name: "Xeovo", Fields: []string{"config"}, open: conf},
		{ID: "cactusvpn", Name: "CactusVPN", Fields: []string{"config"}, open: conf},
		{ID: "vpnac", Name: "VPN.ac", Fields: []string{"config"}, open: conf},
		{ID: "unlocator", Name: "Unlocator VPN", Fields: []string{"config"}, open: conf},
		{ID: Custom, Name: "Own WireGuard config", Fields: []string{"config"}, open: conf},
	}
}
