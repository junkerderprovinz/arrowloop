import type { Mode } from './api'
import type { Translate } from './i18n.data'

export const MODES: Mode[] = ['sync', 'mirror', 'move']

/**
 * All three modes explained in one bubble, each after its own name, for a
 * strip that is inert and whose segments' own bubbles cannot be reached. Two
 * of them delete files, so the difference has to be readable before choosing,
 * not only after.
 */
export function modesHint(t: Translate): string {
  return MODES.map((m) => `${t(`mode.${m}`)}: ${t(`mode.${m}Hint`)}`).join(' ')
}
