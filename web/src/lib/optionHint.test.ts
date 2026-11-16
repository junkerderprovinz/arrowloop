import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { en, type TranslationKey } from './i18n.data'
import { nameAndKind, optionHint, providerHint } from './optionHint'

describe('a provider name on two lines', () => {
  it('puts what the provider is under its name', () => {
    expect(nameAndKind('SMB / Windows-Freigabe')).toEqual({ name: 'SMB', sub: 'Windows-Freigabe' })
  })

  it('leaves a name without a kind on one line', () => {
    expect(nameAndKind('Dropbox')).toEqual({ name: 'Dropbox' })
  })

  it('does not split a name that only contains a slash', () => {
    expect(nameAndKind('Uložto/Files')).toEqual({ name: 'Uložto/Files' })
  })
})

describe('a field bubble', () => {
  const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}${JSON.stringify(vars)}` : key)

  it("puts the app's own words over rclone's for the connections an FTP target opens", () => {
    expect(optionHint({ name: 'concurrency', help: 'Maximum number of FTP simultaneous connections, 0 for unlimited.' }, t, { backend: 'ftp' })).toBe(
      'opt.ftpConcurrencyHint help.rcloneName{"name":"concurrency"}',
    )
    expect(optionHint({ name: 'concurrency', help: 'The maximum number of outstanding requests for one file' }, t, { backend: 'sftp' })).toBe(
      'The maximum number of outstanding requests for one file help.rcloneName{"name":"concurrency"}',
    )
  })

  it("ends a named field's bubble with rclone's name for it", () => {
    expect(optionHint({ name: 'share_name', help: 'Azure Files Share Name.' }, t)).toBe(
      'opt.shareNameHint help.rcloneName{"name":"share_name"}',
    )
  })

  it("keeps rclone's own help where the app has no sentence of its own", () => {
    expect(optionHint({ name: 'chunk_size', help: 'Chunk size to use.' }, t)).toBe(
      'Chunk size to use. help.rcloneName{"name":"chunk_size"}',
    )
  })

  it("says rclone's default, which the field itself leaves to its name", () => {
    expect(optionHint({ name: 'pacer_min_sleep', help: 'Minimum time to sleep between API calls.', default: '10ms' }, t)).toBe(
      'Minimum time to sleep between API calls. help.rcloneName{"name":"pacer_min_sleep"} help.optionDefault{"value":"10ms"}',
    )
  })

  it('leaves the default of a switch to the switch', () => {
    expect(optionHint({ name: 'disable_epsv', default: 'false', type: 'bool' }, t)).not.toContain('help.optionDefault')
  })

  it("says what the server expects instead of rclone's default where the product names one", () => {
    const hint = optionHint({ name: 'region', default: 'us-east-1' }, t, { backend: 's3', defaults: { region: 'garage' } })
    expect(hint).toContain('help.serverDefault{"value":"garage"}')
    expect(hint).not.toContain('help.optionDefault')
  })

  it('gives an example where rclone has no default', () => {
    expect(optionHint({ name: 'region', examples: [{ value: 'us-east-1' }] }, t, { backend: 's3' })).toContain(
      'help.optionExample{"value":"us-east-1"}',
    )
  })

  it('explains how combine writes its targets', () => {
    expect(optionHint({ name: 'upstreams' }, t, { backend: 'combine' })).toContain('opt.upstreamsCombineHint')
    expect(optionHint({ name: 'upstreams' }, t, { backend: 'union' })).toContain('opt.upstreamsHint')
  })

  it('says where the iCloud session comes from', () => {
    expect(optionHint({ name: 'trust_token', help: 'Trust token for session authentication.' }, t, { backend: 'iclouddrive' })).toContain(
      'opt.icloudTrustHint',
    )
    expect(optionHint({ name: 'cookies', help: 'Session cookies.' }, t, { backend: 'iclouddrive' })).toContain('opt.icloudCookiesHint')
  })

  it('names the region a server such as Garage expects', () => {
    expect(optionHint({ name: 'region' }, t, { backend: 's3', defaults: { region: 'garage' } })).toContain(
      'help.serverDefault{"value":"garage"}',
    )
  })
})

describe('the OxiCloud tile', () => {
  const english = (key: TranslationKey, vars: Record<string, string | number> = {}) =>
    en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))

  // The entry travels from the Go table, so the test reads it there.
  const providersGo = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'internal', 'remotes', 'providers.go'),
    'utf8',
  )
  const entry = providersGo.match(/\{ID: "oxicloud",[\s\S]*?UrlHint: "([^"]+)"\}/)
  const oxicloud = { backend: 'webdav', auth: 'apppassword', urlHint: entry?.[1] }

  it('shows the address OxiCloud documents for the personal drive', () => {
    expect(entry, 'no oxicloud entry in providers.go').not.toBeNull()
    expect(optionHint({ name: 'url' }, english, oxicloud)).toContain('https://cloud.example.com/webdav/')
  })

  it('says where OxiCloud makes the app password', () => {
    expect(optionHint({ name: 'pass' }, english, oxicloud)).toContain('OxiCloud: Profile, App Passwords')
  })

  it('is named on the WebDAV tile among the clouds with a tile of their own', () => {
    expect(providerHint('webdav', english)).toContain('OxiCloud')
  })
})
