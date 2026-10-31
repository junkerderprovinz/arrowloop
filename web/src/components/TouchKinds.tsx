import { FilterChoice } from './ListHead'
import { useT, type Translate, type TranslationKey } from '../lib/i18n'

/**
 * The kinds behind each choice of the file log's filter, grouped by what
 * somebody looks for. A `skip` carries the reason a path was not touched, and
 * there is no "error" kind, so trouble means conflict or skip.
 */
export const TOUCH_KINDS = {
  all: [] as string[],
  copied: ['copy', 'move'],
  gone: ['trash', 'rmdir'],
  trouble: ['conflict', 'skip'],
}

export type TouchKind = keyof typeof TOUCH_KINDS

const LABEL: Record<TouchKind, TranslationKey> = {
  all: 'history.everything',
  copied: 'history.onlyCopied',
  gone: 'history.onlyGone',
  trouble: 'history.onlyTrouble',
}

export function touchKindLabel(t: Translate, kind: TouchKind): string {
  return t(LABEL[kind])
}

export function TouchKindChoice({ value, onChange }: { value: TouchKind; onChange: (next: TouchKind) => void }) {
  const { t } = useT()
  return (
    <FilterChoice<TouchKind>
      label={t('history.filterKind')}
      value={value}
      onChange={onChange}
      options={(Object.keys(LABEL) as TouchKind[]).map((kind) => ({ value: kind, label: t(LABEL[kind]) }))}
    />
  )
}
