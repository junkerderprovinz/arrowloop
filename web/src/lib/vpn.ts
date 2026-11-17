// The VPN providers of the settings, in the engine's order
// (internal/vpnconn/catalog.go, which a test holds to this list), and the
// colours of each one's logo in public/vpn: the tile it lights up in, the
// ink of its name there, whether a mask of its own draws it in that ink, and
// whether it is too dark to show in its own colours at rest.

export type VpnField = 'config' | 'accountNumber' | 'token' | 'username' | 'password' | 'location'

export type VpnLogo = { tile: string; ink: string; lit?: boolean; rest?: 'ink' }

export type VpnCatalogEntry = { id: string; name: string; fields: VpnField[]; logo: VpnLogo }

/** The tile of a WireGuard configuration of one's own. */
export const CUSTOM = 'custom'

export const VPN_PROVIDERS: readonly VpnCatalogEntry[] = [
  { id: 'nordvpn', name: 'NordVPN', fields: ['token', 'location'], logo: { tile: '#4580ff', ink: '#ffffff' } },
  { id: 'protonvpn', name: 'Proton VPN', fields: ['config'], logo: { tile: '#6458fa', ink: '#ffffff' } },
  { id: 'surfshark', name: 'Surfshark', fields: ['config'], logo: { tile: '#1ebfbf', ink: '#ffffff', lit: true } },
  { id: 'pia', name: 'Private Internet Access', fields: ['username', 'password', 'location'], logo: { tile: '#50a747', ink: '#ffffff', lit: true } },
  { id: 'mullvad', name: 'Mullvad VPN', fields: ['accountNumber', 'location'], logo: { tile: '#192e45', ink: '#ffffff', lit: true } },
  { id: 'windscribe', name: 'Windscribe', fields: ['config'], logo: { tile: '#000000', ink: '#ffffff', rest: 'ink' } },
  { id: 'ipvanish', name: 'IPVanish', fields: ['config'], logo: { tile: '#6fbb44', ink: '#ffffff' } },
  { id: 'purevpn', name: 'PureVPN', fields: ['config'], logo: { tile: '#3c1190', ink: '#ffffff', lit: true } },
  { id: 'hideme', name: 'hide.me', fields: ['username', 'password', 'location'], logo: { tile: '#0acbf8', ink: '#161616', lit: true } },
  { id: 'airvpn', name: 'AirVPN', fields: ['config'], logo: { tile: '#2266cc', ink: '#ffffff', lit: true } },
  { id: 'ivpn', name: 'IVPN', fields: ['config'], logo: { tile: '#fb3841', ink: '#ffffff' } },
  { id: 'torguard', name: 'TorGuard', fields: ['username', 'password', 'location'], logo: { tile: '#000000', ink: '#ffffff', rest: 'ink' } },
  { id: 'privadovpn', name: 'PrivadoVPN', fields: ['config'], logo: { tile: '#4f58c8', ink: '#ffffff' } },
  { id: 'ovpn', name: 'OVPN', fields: ['config'], logo: { tile: '#006bed', ink: '#ffffff' } },
  { id: 'azirevpn', name: 'AzireVPN', fields: ['username', 'password', 'location'], logo: { tile: '#8229ef', ink: '#ffffff', lit: true } },
  { id: 'fastestvpn', name: 'FastestVPN', fields: ['config'], logo: { tile: '#f9c02a', ink: '#161616' } },
  { id: 'ivacy', name: 'Ivacy VPN', fields: ['config'], logo: { tile: '#24aaf6', ink: '#ffffff' } },
  { id: 'privatevpn', name: 'PrivateVPN', fields: ['config'], logo: { tile: '#9d56b9', ink: '#ffffff', lit: true } },
  { id: 'astrill', name: 'Astrill VPN', fields: ['config'], logo: { tile: '#000000', ink: '#ffffff', rest: 'ink' } },
  { id: 'zoogvpn', name: 'ZoogVPN', fields: ['config'], logo: { tile: '#5fae01', ink: '#ffffff', lit: true } },
  { id: 'cryptostorm', name: 'cryptostorm', fields: ['config'], logo: { tile: '#286666', ink: '#ffffff', lit: true } },
  { id: 'strongvpn', name: 'StrongVPN', fields: ['config'], logo: { tile: '#fcd568', ink: '#161616' } },
  { id: 'vpnunlimited', name: 'VPN Unlimited', fields: ['config'], logo: { tile: '#07b2fa', ink: '#ffffff', lit: true } },
  { id: 'kaspersky', name: 'Kaspersky VPN', fields: ['config'], logo: { tile: '#4be576', ink: '#161616', lit: true } },
  { id: 'anonine', name: 'Anonine', fields: ['config'], logo: { tile: '#000000', ink: '#ffffff', rest: 'ink' } },
  { id: 'njalla', name: 'Njalla VPN', fields: ['config'], logo: { tile: '#213843', ink: '#ffffff', rest: 'ink' } },
  { id: 'trustzone', name: 'Trust.Zone', fields: ['config'], logo: { tile: '#fcc801', ink: '#161616', lit: true } },
  { id: 'obscura', name: 'Obscura VPN', fields: ['accountNumber', 'location'], logo: { tile: '#ff6025', ink: '#ffffff', rest: 'ink', lit: true } },
  { id: 'levpn', name: 'Le VPN', fields: ['config'], logo: { tile: '#59ce97', ink: '#161616', lit: true } },
  { id: 'xeovo', name: 'Xeovo', fields: ['config'], logo: { tile: '#06da69', ink: '#161616' } },
  { id: 'cactusvpn', name: 'CactusVPN', fields: ['config'], logo: { tile: '#98c000', ink: '#ffffff' } },
  { id: 'vpnac', name: 'VPN.ac', fields: ['config'], logo: { tile: '#13314c', ink: '#ffffff', lit: true } },
  { id: 'unlocator', name: 'Unlocator VPN', fields: ['config'], logo: { tile: '#668efe', ink: '#ffffff', lit: true } },
  { id: 'custom', name: 'Own WireGuard config', fields: ['config'], logo: { tile: '#88181b', ink: '#ffffff' } },
]

/** Where the VPN stands: down while no run needs it. */
export type VpnStatus = 'down' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

export type VpnProviderState = {
  id: string
  name: string
  fields: VpnField[]
  /** A login is stored; it never comes back to the page. */
  configured: boolean
  location?: string
}

export type VpnState = {
  /** The provider jobs go through, '' for none. */
  provider: string
  status: VpnStatus
  /** The jobs whose runs hold the tunnel up. */
  jobs: string[]
  endpoint?: string
  exitIp?: string
  error?: string
  errorCode?: string
  providers: VpnProviderState[]
}
