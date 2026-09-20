import type { TranslationKey } from './i18n.data'

/**
 * Translated labels for the rclone options a form shows, the ones marked
 * required or essential. Advanced options keep their rclone name, which is what
 * somebody following rclone's documentation searches for, and a name with no
 * entry falls back to itself.
 */
const NAMES: Record<string, TranslationKey> = {
  user: 'opt.user',
  username: 'opt.user',
  pass: 'opt.pass',
  password: 'opt.pass',
  host: 'opt.host',
  url: 'opt.url',
  port: 'opt.port',
  domain: 'opt.domain',
  token: 'opt.token',
  vendor: 'opt.vendor',
  provider: 'opt.provider',
  region: 'opt.region',
  endpoint: 'opt.endpoint',
  account: 'opt.account',
  key: 'opt.key',
  key_file: 'opt.keyFile',
  access_key_id: 'opt.accessKey',
  secret_access_key: 'opt.secretKey',
  access_grant: 'opt.accessGrant',
  client_id: 'opt.clientId',
  client_secret: 'opt.clientSecret',
  remote: 'opt.remote',
  library: 'opt.library',
  hostname: 'opt.hostname',
  drive_id: 'opt.driveId',
  drive_type: 'opt.driveType',
  scope: 'opt.scope',
  '2fa': 'opt.twoFactor',
}

/** The label for one option: its translation where there is one, its rclone name otherwise. */
export function optionLabel(name: string, t: (key: TranslationKey) => string): string {
  const key = NAMES[name]
  return key ? t(key) : name
}

/** Whether this option has a translated name at all. */
export function hasOptionLabel(name: string): boolean {
  return NAMES[name] !== undefined
}
