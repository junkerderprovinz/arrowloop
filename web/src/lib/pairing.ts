// Where an instance stands in its group and how a refusal reads, kept apart
// from the cards so the rules can be tested without drawing them.

import { ApiError, type ConnectInfo, type Deployment } from './api'
import type { Translate, TranslationKey } from './i18n.data'
import { since } from './since'

/** How long a new member may take to show up before the card suggests why
 *  nobody has. The relay puts a member through within seconds. */
export const ALONE_AFTER_S = 60

/** "gone" is a group whose members were there once and are unreachable now. */
export type PairStage = 'unpaired' | 'new' | 'searching' | 'alone' | 'gone' | 'paired'

/**
 * The stage, read from the group, the seconds since this instance entered it
 * and whether this page made its phrase.
 */
export function pairStage(g: Pick<ConnectInfo, 'active' | 'members' | 'memberSeen'>, joinedAgo: number, createdHere: boolean): PairStage {
  if (!g.active) return 'unpaired'
  if (g.members.length > 0) return 'paired'
  if (g.memberSeen) return 'gone'
  if (joinedAgo >= ALONE_AFTER_S) return 'alone'
  return createdHere ? 'new' : 'searching'
}

export const KIND: Record<Deployment, TranslationKey> = {
  container: 'instances.kind.container',
  server: 'instances.kind.server',
  desktop: 'instances.kind.desktop',
  phone: 'instances.kind.phone',
}

/** The kind an instance announced, in the reader's words, or nothing for one it did not. */
export function kindName(t: Translate, deployment: string): string {
  return deployment in KIND ? t(KIND[deployment as Deployment]) : ''
}

/** A refused phrase, pairing request or address in the reader's language. */
export function refusalText(t: Translate, e: unknown): string {
  if (e instanceof ApiError) {
    const v = e.values ?? {}
    switch (e.code) {
      case 'word_count':
        return t('pairing.errWordCount', { count: v.count ?? '' })
      case 'unknown_word':
        return t('pairing.errUnknownWord', { position: v.position ?? '', word: v.word ?? '' })
      case 'checksum':
        return t('pairing.errChecksum')
      case 'phraseExists':
        return t('pairing.errExists')
      case 'addressNotNearby':
        return t('pairing.addresses.errNotNearby')
      case 'addressUnreachable':
        return t('pairing.addresses.errUnreachable', { address: v.address ?? '' })
      case 'addressStranger':
        return t('pairing.addresses.errStranger', { address: v.address ?? '' })
      case 'addressSelf':
        return t('pairing.addresses.errSelf', { address: v.address ?? '' })
      case 'addressRemoved':
        return t('pairing.addresses.errRemoved', { address: v.address ?? '' })
      case 'addressesFull':
        return t('pairing.addresses.errFull', { count: v.count ?? '32' })
    }
    if (e.status === 403) return t('login.wrong')
    if (e.status === 429) return t('login.locked')
  }
  return e instanceof Error ? e.message : String(e)
}

/** When something was last seen, from Unix seconds, as "5 minutes ago". */
export function seenAgo(lang: string, unixSeconds: number, now = Date.now()): string {
  const { count, unit } = since(new Date(unixSeconds * 1000).toISOString(), now)
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-count, unit)
}
