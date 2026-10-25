import { describe, expect, it } from 'vitest'

import { nameAndKind, optionHint } from './optionHint'

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

  it("ends a named field's bubble with rclone's name for it", () => {
    expect(optionHint({ name: 'share_name', help: 'Azure Files Share Name.' }, t)).toBe(
      'opt.shareNameHint help.rcloneName{"name":"share_name"}',
    )
  })

  it("keeps rclone's own help for a field it has no name for", () => {
    expect(optionHint({ name: 'chunk_size', help: 'Chunk size to use.' }, t)).toBe('Chunk size to use.')
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
