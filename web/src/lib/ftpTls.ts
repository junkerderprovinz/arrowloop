// FTP's encryption as one choice. rclone keeps it in two switches, tls for
// implicit and explicit_tls for explicit, and refuses a target with both on.

export type FtpTls = 'none' | 'explicit' | 'implicit'

export const FTP_TLS: FtpTls[] = ['none', 'explicit', 'implicit']

/** The encryption a form's values describe. Implicit wins over both on, as it decides the port. */
export function ftpTls(values: Record<string, string>): FtpTls {
  if (values.tls === 'true') return 'implicit'
  if (values.explicit_tls === 'true') return 'explicit'
  return 'none'
}

/**
 * The values with one encryption set. Implicit TLS listens on 990, so the port
 * follows it where the field still holds FTP's usual one or none, and goes back
 * when implicit is left.
 */
export function withFtpTls(values: Record<string, string>, mode: FtpTls): Record<string, string> {
  const port = values.port ?? ''
  const next: Record<string, string> = {
    ...values,
    tls: mode === 'implicit' ? 'true' : '',
    explicit_tls: mode === 'explicit' ? 'true' : '',
  }
  if (mode === 'implicit' && (port === '' || port === '21')) next.port = '990'
  if (mode !== 'implicit' && port === '990') next.port = ''
  return next
}
