// The VPN providers of the settings, in the engine's order
// (internal/vpnconn/catalog.go, which a test holds to this list). Their marks
// are GlimStone's; a provider the catalog draws only as a glyph has a logo in
// public/vpn instead, with its colours: the tile it lights up in, the ink of
// its name there, whether a mask of its own draws it in that ink, and whether
// it is too dark to show in its own colours at rest.

export type VpnField = 'config' | 'accountNumber' | 'token' | 'username' | 'password' | 'location'

export type VpnLogo = { tile: string; ink: string; lit?: boolean; rest?: 'ink' }

export type VpnCatalogEntry = { id: string; name: string; fields: VpnField[]; logo?: VpnLogo }

/** The tile of a WireGuard configuration of one's own. */
export const CUSTOM = 'custom'

export const VPN_PROVIDERS: readonly VpnCatalogEntry[] = [
  { id: 'nordvpn', name: 'NordVPN', fields: ['token', 'location'] },
  { id: 'protonvpn', name: 'Proton VPN', fields: ['config'] },
  { id: 'surfshark', name: 'Surfshark', fields: ['config'] },
  { id: 'pia', name: 'Private Internet Access', fields: ['username', 'password', 'location'] },
  { id: 'mullvad', name: 'Mullvad VPN', fields: ['accountNumber', 'location'] },
  { id: 'windscribe', name: 'Windscribe', fields: ['config'] },
  { id: 'ipvanish', name: 'IPVanish', fields: ['config'] },
  { id: 'purevpn', name: 'PureVPN', fields: ['config'] },
  { id: 'hideme', name: 'hide.me', fields: ['username', 'password', 'location'] },
  { id: 'airvpn', name: 'AirVPN', fields: ['config'] },
  { id: 'ivpn', name: 'IVPN', fields: ['config'] },
  { id: 'torguard', name: 'TorGuard', fields: ['username', 'password', 'location'], logo: { tile: '#000000', ink: '#ffffff', rest: 'ink' } },
  { id: 'privadovpn', name: 'PrivadoVPN', fields: ['config'] },
  { id: 'ovpn', name: 'OVPN', fields: ['config'] },
  { id: 'azirevpn', name: 'AzireVPN', fields: ['username', 'password', 'location'] },
  { id: 'fastestvpn', name: 'FastestVPN', fields: ['config'], logo: { tile: '#f9c02a', ink: '#161616' } },
  { id: 'ivacy', name: 'Ivacy VPN', fields: ['config'], logo: { tile: '#24aaf6', ink: '#ffffff' } },
  { id: 'privatevpn', name: 'PrivateVPN', fields: ['config'] },
  { id: 'astrill', name: 'Astrill VPN', fields: ['config'], logo: { tile: '#000000', ink: '#ffffff', rest: 'ink' } },
  { id: 'zoogvpn', name: 'ZoogVPN', fields: ['config'] },
  { id: 'cryptostorm', name: 'cryptostorm', fields: ['config'], logo: { tile: '#286666', ink: '#ffffff', lit: true } },
  { id: 'strongvpn', name: 'StrongVPN', fields: ['config'] },
  { id: 'vpnunlimited', name: 'VPN Unlimited', fields: ['config'] },
  { id: 'kaspersky', name: 'Kaspersky VPN', fields: ['config'] },
  { id: 'anonine', name: 'Anonine', fields: ['config'], logo: { tile: '#000000', ink: '#ffffff', rest: 'ink' } },
  { id: 'njalla', name: 'Njalla VPN', fields: ['config'] },
  { id: 'trustzone', name: 'Trust.Zone', fields: ['config'] },
  { id: 'obscura', name: 'Obscura VPN', fields: ['accountNumber', 'location'] },
  { id: 'levpn', name: 'Le VPN', fields: ['config'] },
  { id: 'xeovo', name: 'Xeovo', fields: ['config'], logo: { tile: '#06da69', ink: '#161616' } },
  { id: 'cactusvpn', name: 'CactusVPN', fields: ['config'] },
  { id: 'vpnac', name: 'VPN.ac', fields: ['config'], logo: { tile: '#13314c', ink: '#ffffff', lit: true } },
  { id: 'unlocator', name: 'Unlocator VPN', fields: ['config'] },
  { id: 'custom', name: 'WireGuard', fields: ['config'] },
]

/** Where a VPN stands: down while no run needs it. */
export type VpnStatus = 'down' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

export type VpnProviderState = { id: string; name: string; fields: VpnField[] }

/** One VPN set up with a provider. Its login never comes back to the page. */
export type VpnTunnelState = {
  id: string
  provider: string
  /** The location its login names, or the host of its endpoint. */
  place?: string
  status: VpnStatus
  /** The jobs whose runs hold it up. */
  jobs: string[]
  endpoint?: string
  exitIp?: string
  error?: string
  errorCode?: string
}

export type VpnState = { tunnels: VpnTunnelState[]; providers: VpnProviderState[] }

/** A VPN by its provider's name and where it leads, which tells two of one provider apart. */
export function tunnelName(tunnel: VpnTunnelState, providers: readonly { id: string; name: string }[]): string {
  const name = providers.find((p) => p.id === tunnel.provider)?.name ?? tunnel.provider
  return tunnel.place ? `${name} (${tunnel.place})` : name
}
