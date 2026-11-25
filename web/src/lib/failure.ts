// What a failed run says in the reader's language, for the browser and the
// phone. The engine names the kinds of failure it knows in internal/failure
// and sends the figures beside its own English text.

import { bytes } from './bytes.ts'
import type { Translate, TranslationKey } from './i18n.data'
import { exactMoment, reasonText, type Spelling } from './reasonText.ts'

/** A kind of failure the engine named, with the figures its sentence needs. */
export type Failure = { code: string; params?: Record<string, string>; twice?: Twice }

/**
 * The first files a run left for later in two runs in a row, each with its
 * reason as a code and values beside the English, and how many more there were.
 */
export type Twice = { files: { path: string; code: string; vars?: Record<string, string>; text: string }[]; more?: number }

type Side = 'left' | 'right'

/** The sentence for each kind: one per side where the engine says which, and one for neither. */
const SAID: Record<string, Partial<Record<Side | 'either', TranslationKey>>> = {
  notEnoughSpace: { left: 'failure.notEnoughSpace.left', right: 'failure.notEnoughSpace.right' },
  volumeMissing: { left: 'failure.volumeMissing.left', right: 'failure.volumeMissing.right' },
  unreachable: { either: 'failure.unreachable', left: 'failure.unreachable.left', right: 'failure.unreachable.right' },
  signInFailed: { either: 'failure.signInFailed', left: 'failure.signInFailed.left', right: 'failure.signInFailed.right' },
  signInAgain: { either: 'failure.signInAgain' },
  twoFactorRefused: { either: 'failure.twoFactorRefused' },
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
  trashRefused: { left: 'failure.trashRefused.left', right: 'failure.trashRefused.right' },
}

/**
 * The sentence for a failure the engine named, and the engine's own words
 * where they still tell something, such as what a command printed. A failure
 * it did not name keeps its English text under a lead saying whose words
 * they are. Files left for later twice are named with their reasons in the
 * reader's language where the engine sent their codes, and `spell` writes
 * the numbers and moments those reasons hold.
 */
export function sayFailure(
  raw: string,
  failure: Failure | null | undefined,
  t: Translate,
  lang: string,
  spell: Spelling = { lang, moment: (iso) => exactMoment(iso, lang) },
): { said: string; engine?: string; files?: string[] } {
  const sentences = failure ? SAID[failure.code] : undefined
  const side = failure?.params?.side
  const key = sentences && (side === 'left' || side === 'right' ? (sentences[side] ?? sentences.either) : sentences.either)
  if (!failure || !key) return { said: t('failure.engineSaid'), engine: raw }
  const p = failure.params ?? {}
  const said = t(key, { free: bytes(Number(p.free), lang), needed: bytes(Number(p.needed), lang) })
  if (failure.twice) return { said, files: leftFiles(failure.twice, t, spell) }
  return { said, engine: p.output || undefined }
}

/** One line per file left for later twice, and one for how many more there were. */
function leftFiles(twice: Twice, t: Translate, spell: Spelling): string[] {
  const lines = twice.files.map((f) =>
    t('failure.leftFile', { path: f.path, reason: reasonText(t, { code: f.code, vars: f.vars, text: f.text }, spell) }),
  )
  if (twice.more) lines.push(t('failure.leftMore', { count: twice.more }))
  return lines
}

/**
 * Kinds whose engine words are a VPN provider's or the tunnel's own English,
 * which the run's page shows under the sentence and a one-line row leaves out.
 */
const DETAIL_ONLY = new Set(['vpnDown', 'vpnUnreached', 'vpnRefused'])

/** The same on one line, for a row with room for nothing more. */
export function failureLine(
  raw: string,
  failure: Failure | null | undefined,
  t: Translate,
  lang: string,
  spell?: Spelling,
): string {
  const { said, engine, files } = sayFailure(raw, failure, t, lang, spell)
  if (files) return [said, ...files].join(' ')
  return engine && !DETAIL_ONLY.has(failure?.code ?? '') ? `${said} ${engine}` : said
}
