// What a failed run says in the reader's language, for the browser and the
// phone. The engine names the kinds of failure it knows in internal/failure
// and sends the figures beside its own English text.

import { bytes } from './bytes'
import type { Translate, TranslationKey } from './i18n.data'

/** A kind of failure the engine named, with the figures its sentence needs. */
export type Failure = { code: string; params?: Record<string, string> }

type Side = 'left' | 'right'

/** The sentence for each kind: one per side where the engine says which, and one for neither. */
const SAID: Record<string, Partial<Record<Side | 'either', TranslationKey>>> = {
  notEnoughSpace: { left: 'failure.notEnoughSpace.left', right: 'failure.notEnoughSpace.right' },
  volumeMissing: { left: 'failure.volumeMissing.left', right: 'failure.volumeMissing.right' },
  unreachable: { either: 'failure.unreachable', left: 'failure.unreachable.left', right: 'failure.unreachable.right' },
  signInFailed: { either: 'failure.signInFailed', left: 'failure.signInFailed.left', right: 'failure.signInFailed.right' },
  permissionDenied: {
    either: 'failure.permissionDenied',
    left: 'failure.permissionDenied.left',
    right: 'failure.permissionDenied.right',
  },
  noFileAccess: { either: 'failure.noFileAccess' },
  notFound: { either: 'failure.notFound', left: 'failure.notFound.left', right: 'failure.notFound.right' },
  quotaExceeded: { either: 'failure.quotaExceeded', left: 'failure.quotaExceeded.left', right: 'failure.quotaExceeded.right' },
  rateLimited: { either: 'failure.rateLimited', left: 'failure.rateLimited.left', right: 'failure.rateLimited.right' },
  hostKeyChanged: {
    either: 'failure.hostKeyChanged',
    left: 'failure.hostKeyChanged.left',
    right: 'failure.hostKeyChanged.right',
  },
  certificateUntrusted: {
    either: 'failure.certificateUntrusted',
    left: 'failure.certificateUntrusted.left',
    right: 'failure.certificateUntrusted.right',
  },
  tooManyLogins: {
    either: 'failure.tooManyLogins',
    left: 'failure.tooManyLogins.left',
    right: 'failure.tooManyLogins.right',
  },
  stopped: { either: 'failure.stopped' },
  beforeFailed: { either: 'failure.beforeFailed' },
  afterFailed: { either: 'failure.afterFailed' },
  leftTwice: { either: 'failure.leftTwice' },
  vpnDown: { either: 'failure.vpnDown' },
  vpnUnreached: { either: 'failure.vpnUnreached' },
  vpnRefused: { left: 'failure.vpnRefused.left', right: 'failure.vpnRefused.right' },
  noVpn: { either: 'failure.noVpn' },
}

/**
 * The sentence for a failure the engine named, and the engine's own words
 * where they still tell something, such as what a command printed. A failure
 * it did not name keeps its English text under a lead saying whose words
 * they are.
 */
export function sayFailure(
  raw: string,
  failure: Failure | null | undefined,
  t: Translate,
  lang: string,
): { said: string; engine?: string } {
  const sentences = failure ? SAID[failure.code] : undefined
  const side = failure?.params?.side
  const key = sentences && (side === 'left' || side === 'right' ? (sentences[side] ?? sentences.either) : sentences.either)
  if (!failure || !key) return { said: t('failure.engineSaid'), engine: raw }
  const p = failure.params ?? {}
  const said = t(key, { free: bytes(Number(p.free), lang), needed: bytes(Number(p.needed), lang) })
  return { said, engine: p.output || undefined }
}

/**
 * Kinds whose engine words are a VPN provider's or the tunnel's own English,
 * which the run's page shows under the sentence and a one-line row leaves out.
 */
const DETAIL_ONLY = new Set(['vpnDown', 'vpnUnreached', 'vpnRefused'])

/** The same on one line, for a row with room for nothing more. */
export function failureLine(raw: string, failure: Failure | null | undefined, t: Translate, lang: string): string {
  const { said, engine } = sayFailure(raw, failure, t, lang)
  return engine && !DETAIL_ONLY.has(failure?.code ?? '') ? `${said} ${engine}` : said
}
