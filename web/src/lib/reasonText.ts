import { amount } from './anomalies.ts'
import { capitalized } from './capitalized.ts'
import type { TranslationKey } from './i18n.data'

// Shared by the browser and the phone, so it imports nothing that needs React
// or the web's locale loader, and is handed the translate function.

/** One reason from the engine: a code with its values, and the English sentence. */
export type Reason = { code: string; vars?: Record<string, string>; text: string }

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string

/**
 * How the reader's language writes what a reason holds: numbers by `lang`,
 * and a moment by whatever the surface shows times with.
 */
export type Spelling = { lang: string; moment: (iso: string) => string }

/** The steps a failure names as {what}, as internal/apply's whyFailed is told them. */
const WHAT: Record<string, TranslationKey> = {
  copy: 'reason.what.copy',
  delete: 'reason.what.delete',
  move: 'reason.what.move',
  relocate: 'reason.what.relocate',
  conflict: 'reason.what.conflict',
  mkdir: 'reason.what.mkdir',
  rmdir: 'reason.what.rmdir',
  'removing the folder': 'reason.what.rmdir',
  record: 'reason.what.record',
}

/** What a side holds that the engine does not carry, as internal/scan names it. */
const KIND: Record<string, TranslationKey> = {
  'symbolic link': 'reason.kind.symlink',
  socket: 'reason.kind.socket',
  'named pipe': 'reason.kind.pipe',
  'character device': 'reason.kind.charDevice',
  'device node': 'reason.kind.device',
  'irregular file': 'reason.kind.irregular',
}

/**
 * A reason in the reader's language, with the values the engine wrote in
 * English worded too. A sentence may open with one of them, such as the side
 * in German, and still starts with a capital. A code this build has no
 * sentence for comes from a newer engine and keeps the engine's own.
 */
export function reasonText(t: T, reason: Reason, spell: Spelling): string {
  const key = `reason.${reason.code}` as TranslationKey
  const given = reason.vars ?? {}
  const count = (n: string) => new Intl.NumberFormat(spell.lang).format(Number(n))
  const vars: Record<string, string> = { ...given }
  for (const name of ['side', 'other']) {
    if (given[name]) vars[name] = sideWord(t, given[name])
  }
  const what = given.what ? WHAT[given.what] : undefined
  const kind = given.kind ? KIND[given.kind] : undefined
  if (what) vars.what = t(what)
  if (kind) vars.kind = t(kind)
  if (given.runs) vars.runs = count(given.runs)
  if (given.seconds) vars.period = amount('duration', Number(given.seconds), t)
  if (reason.code === 'inFlux') vars.details = fluxDetails(t, given, spell, count) ?? given.details ?? ''
  const said = t(key, vars)
  // Both surfaces hand back the key itself for a sentence they do not have.
  return said === key ? reason.text : capitalized(said, spell.lang)
}

/** A side named by the engine, in the reader's language. */
export function sideWord(t: T, side: string): string {
  if (side === 'left') return t('side.left')
  if (side === 'right') return t('side.right')
  return side
}

/**
 * What a file in flux read differently, one sentence per fact, from the values
 * internal/apply's afterCopy and whileRead give. Null where the engine had
 * nothing but an error's own words.
 */
function fluxDetails(t: T, v: Record<string, string>, spell: Spelling, count: (n: string) => string): string | null {
  const said: string[] = []
  if (v.leftSize && v.rightSize) said.push(t('reason.flux.sizeAfter', { left: count(v.leftSize), right: count(v.rightSize) }))
  if (v.leftSum && v.rightSum) said.push(t('reason.flux.sumAfter', { left: v.leftSum, right: v.rightSum }))
  if (v.leftTime && v.rightTime)
    said.push(t('reason.flux.timeAfter', { left: spell.moment(v.leftTime), right: spell.moment(v.rightTime) }))
  if (v.sizeFrom && v.sizeTo) said.push(t('reason.flux.sizeWhile', { from: count(v.sizeFrom), to: count(v.sizeTo) }))
  if (v.timeFrom && v.timeTo)
    said.push(t('reason.flux.timeWhile', { from: spell.moment(v.timeFrom), to: spell.moment(v.timeTo) }))
  return said.length ? said.join(' ') : null
}

/**
 * A moment to the second, and to the millisecond where it has a fraction,
 * since two times a file is compared by can lie within one second.
 */
export function exactMoment(iso: string, locale: string, extra: Intl.DateTimeFormatOptions = {}): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const fraction = at.getUTCMilliseconds() !== 0 ? { fractionalSecondDigits: 3 as const } : {}
  return at.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...fraction,
    ...extra,
  })
}
