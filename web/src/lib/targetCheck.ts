import type { TranslationKey } from './i18n.data'

/**
 * What a target's check came to, in the words of its badge. A target that a
 * job reaches through its VPN is left unchecked while that VPN is off, since
 * a look nobody asked for brings no tunnel up and never goes past it.
 */
export function checkWord(answer: { ok: boolean; unchecked?: boolean }): TranslationKey {
  if (answer.ok) return 'targets.checkOk'
  return answer.unchecked ? 'targets.throughVpn' : 'targets.checkFailed'
}
