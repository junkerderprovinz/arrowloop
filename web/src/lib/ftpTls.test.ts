import { describe, expect, it } from 'vitest'

import { ftpTls, withFtpTls } from './ftpTls'

describe('FTP encryption', () => {
  it('never leaves both kinds of TLS on', () => {
    const both = { tls: 'true', explicit_tls: 'true' }
    expect(ftpTls(both)).toBe('implicit')
    const explicit = withFtpTls(both, 'explicit')
    expect(explicit.tls).toBe('')
    expect(explicit.explicit_tls).toBe('true')
  })

  it('moves to port 990 for implicit TLS and back again', () => {
    const implicit = withFtpTls({ port: '21' }, 'implicit')
    expect(implicit.port).toBe('990')
    expect(withFtpTls(implicit, 'none')).toMatchObject({ port: '', tls: '', explicit_tls: '' })
  })

  it('keeps a port somebody chose', () => {
    expect(withFtpTls({ port: '2121' }, 'implicit').port).toBe('2121')
  })
})
