// The VPN providers of the settings, in the engine's order
// (internal/vpnconn/catalog.go, which a test holds to this list). Their marks
// are GlimStone's. The browser and the phone share everything here.

import type { Translate, TranslationKey } from './i18n.data'

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
  /** The wifi networks on which its jobs connect directly. */
  trustedWifi?: string[]
}

export type VpnState = { tunnels: VpnTunnelState[]; providers: VpnProviderState[] }

/** A VPN by its provider's name and where it leads, which tells two of one provider apart. */
export function tunnelName(tunnel: VpnTunnelState, providers: readonly { id: string; name: string }[]): string {
  const name = providers.find((p) => p.id === tunnel.provider)?.name ?? tunnel.provider
  return tunnel.place ? `${name} (${tunnel.place})` : name
}

/**
 * How a VPN stands. Off and connected are its normal states and are only said
 * in the status line; the others are a badge after its name as well.
 */
export const VPN_STATUS: Record<VpnStatus, { word: TranslationKey; badge?: 'warn' | 'fail' }> = {
  down: { word: 'vpn.status.down' },
  connecting: { word: 'vpn.status.connecting', badge: 'warn' },
  connected: { word: 'vpn.status.connected' },
  reconnecting: { word: 'vpn.status.reconnecting', badge: 'warn' },
  failed: { word: 'vpn.status.failed', badge: 'fail' },
}

/** Why a connection failed, by the code the engine gives (internal/vpnconn). */
const FAILURES: Record<string, TranslationKey> = {
  'vpn-config-invalid': 'vpn.error.config',
  'vpn-login-refused': 'vpn.error.login',
  'vpn-timeout': 'vpn.error.timeout',
  'vpn-name-unresolved': 'vpn.error.nameUnresolved',
  'vpn-device-limit': 'vpn.error.deviceLimit',
  'vpn-account-expired': 'vpn.error.accountExpired',
  'vpn-location-unknown': 'vpn.error.locationUnknown',
  'vpn-start-failed': 'vpn.error.start',
}

/**
 * Why a VPN did not come up, in the reader's words where the engine gave a
 * code, and the engine's own English as the detail.
 */
export function vpnFailure(
  t: Translate,
  st: Pick<VpnTunnelState, 'error' | 'errorCode'>,
  name: string,
): { said: string; detail?: string } {
  const key = st.errorCode ? FAILURES[st.errorCode] : undefined
  return key ? { said: t(key, { name, reason: st.error ?? '' }), detail: st.error } : { said: st.error ?? '' }
}

export const VPN_FIELDS: Record<VpnField, { label: TranslationKey; hint?: TranslationKey; secret?: boolean }> = {
  config: { label: 'vpn.field.config' },
  accountNumber: { label: 'vpn.field.accountNumber', hint: 'vpn.field.accountNumberHint', secret: true },
  token: { label: 'vpn.field.token', hint: 'vpn.field.tokenHint', secret: true },
  username: { label: 'vpn.field.username', hint: 'vpn.field.usernameHint' },
  password: { label: 'vpn.field.password', secret: true },
  location: { label: 'vpn.field.location', hint: 'vpn.field.locationHint' },
}

/** What each provider takes as a location, and what an empty field means there. */
const LOCATION_HINTS: Partial<Record<string, TranslationKey>> = {
  nordvpn: 'vpn.field.locationHint.nordvpn',
  pia: 'vpn.field.locationHint.pia',
  mullvad: 'vpn.field.locationHint.mullvad',
  hideme: 'vpn.field.locationHint.hideme',
  torguard: 'vpn.field.locationHint.torguard',
  azirevpn: 'vpn.field.locationHint.azirevpn',
  obscura: 'vpn.field.locationHint.obscura',
}

/** The (i) of a provider's field, which for its location says what that provider takes. */
export function vpnFieldHint(t: Translate, provider: string, field: VpnField, name: string): string | undefined {
  if (field === 'config') return t(provider === CUSTOM ? 'vpn.field.configHintOwn' : 'vpn.field.configHint', { name })
  const key = (field === 'location' && LOCATION_HINTS[provider]) || VPN_FIELDS[field].hint
  return key && t(key, { name })
}

/**
 * What the form of a VPN set up says about the login it keeps. A stored .conf
 * never comes back into its field, which would otherwise read as lost.
 */
export function vpnKeepHint(t: Translate, fields: readonly VpnField[]): string {
  return t(fields.includes('config') ? 'vpn.keepSavedConfig' : 'vpn.keepSaved')
}

/** What a provider's login needs said before it is entered. */
export const VPN_NOTES: Partial<Record<string, TranslationKey>> = {
  kaspersky: 'vpn.note.kaspersky',
  anonine: 'vpn.note.anonine',
  nordvpn: 'vpn.note.nordvpn',
  pia: 'vpn.note.pia',
  torguard: 'vpn.note.torguard',
}

/**
 * Whether a VPN's form can be saved: one set up keeps what it has for every
 * field left empty, a new one needs everything but the location.
 */
export function vpnFilled(fields: readonly VpnField[], values: Partial<Record<VpnField, string>>, saved: boolean): boolean {
  return saved || fields.every((f) => f === 'location' || values[f]?.trim())
}

/** Why the engine refused a VPN's login, in the reader's words, from its code and the values it named. */
export function vpnRefusal(
  t: Translate,
  refused: { code?: string; values?: Record<string, unknown>; message: string },
  name: string,
): { missing: VpnField } | { said: string; detail?: string } | null {
  const field = refused.values?.field as VpnField | undefined
  if (refused.code === 'vpn-field-missing' && field) return { missing: field }
  if (refused.code !== 'vpn-config-invalid') return null
  const line = refused.values?.line
  const said = line
    ? t('vpn.error.configLine', { line: String(line), text: String(refused.values?.text ?? '') })
    : t('vpn.error.config', { name })
  return { said, detail: refused.message }
}

/**
 * The line under a job's choice of VPN: an engine without one, the one the job
 * names gone, or none set up yet. `fails` marks the two that make its runs
 * fail, which alone are drawn as a warning.
 */
export function vpnChoiceNote(
  offered: boolean,
  tunnels: readonly { id: string }[],
  value: string,
): { said: TranslationKey; fails: boolean } | null {
  if (!offered) return { said: 'edit.vpnNotHere', fails: true }
  if (value && !tunnels.some((x) => x.id === value)) return { said: 'edit.vpnGone', fails: true }
  if (tunnels.length === 0) return { said: 'edit.vpnNone', fails: false }
  return null
}
