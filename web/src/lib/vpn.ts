// The VPN providers of the settings, in the engine's order
// (internal/vpnconn/catalog.go, which a test holds to this list). Their marks
// are GlimStone's.

export type VpnField = 'config' | 'accountNumber' | 'token' | 'username' | 'password' | 'location'

export type VpnCatalogEntry = { id: string; name: string; fields: VpnField[] }

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
  { id: 'torguard', name: 'TorGuard', fields: ['username', 'password', 'location'] },
  { id: 'privadovpn', name: 'PrivadoVPN', fields: ['config'] },
  { id: 'ovpn', name: 'OVPN', fields: ['config'] },
  { id: 'azirevpn', name: 'AzireVPN', fields: ['username', 'password', 'location'] },
  { id: 'fastestvpn', name: 'FastestVPN', fields: ['config'] },
  { id: 'ivacy', name: 'Ivacy VPN', fields: ['config'] },
  { id: 'privatevpn', name: 'PrivateVPN', fields: ['config'] },
  { id: 'astrill', name: 'Astrill VPN', fields: ['config'] },
  { id: 'zoogvpn', name: 'ZoogVPN', fields: ['config'] },
  { id: 'cryptostorm', name: 'cryptostorm', fields: ['config'] },
  { id: 'strongvpn', name: 'StrongVPN', fields: ['config'] },
  { id: 'vpnunlimited', name: 'VPN Unlimited', fields: ['config'] },
  { id: 'kaspersky', name: 'Kaspersky VPN', fields: ['config'] },
  { id: 'anonine', name: 'Anonine', fields: ['config'] },
  { id: 'njalla', name: 'Njalla VPN', fields: ['config'] },
  { id: 'trustzone', name: 'Trust.Zone', fields: ['config'] },
  { id: 'obscura', name: 'Obscura VPN', fields: ['accountNumber', 'location'] },
  { id: 'levpn', name: 'Le VPN', fields: ['config'] },
  { id: 'xeovo', name: 'Xeovo', fields: ['config'] },
  { id: 'cactusvpn', name: 'CactusVPN', fields: ['config'] },
  { id: 'vpnac', name: 'VPN.ac', fields: ['config'] },
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
