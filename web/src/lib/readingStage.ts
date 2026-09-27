import type { TranslationKey } from './i18n.data'

/** The line that names a stage of reading a job, for the desktop and the phone. */
export function stageKey(stage: 'list' | 'check' | 'compare', side?: string): TranslationKey {
  if (stage === 'compare') return 'progress.compare'
  const right = side === 'right'
  if (stage === 'check') return right ? 'progress.checkRight' : 'progress.checkLeft'
  return right ? 'progress.listRight' : 'progress.listLeft'
}
