// A server certificate no known authority vouches for, which a target can
// trust by its fingerprint (internal/certpin), for the browser and the phone.

/** The setting that holds the trusted fingerprint (internal/remotes/certificate.go). */
export const CERTIFICATE_KEY = 'trusted_certificate'

/**
 * A certificate a test refused. Where the engine only kept its fingerprint,
 * the other fields are empty.
 */
export type RefusedCertificate = {
  fingerprint: string
  subject: string
  issuer: string
  notAfter: string
  /** The target trusts another certificate. */
  changed: boolean
}
