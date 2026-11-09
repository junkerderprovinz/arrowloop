import type { TranslationKey } from './i18n.data'

/** The line that names a stage of reading a job. */
export function stageKey(stage: 'list' | 'compare', side?: string): TranslationKey {
  if (stage === 'compare') return 'progress.compare'
  return side === 'right' ? 'progress.listRight' : 'progress.listLeft'
}
