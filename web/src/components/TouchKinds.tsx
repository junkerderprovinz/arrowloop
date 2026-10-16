import { FilterChoice } from './ListBar'
import { useT } from '../lib/i18n'

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

export function TouchKindChoice({ value, onChange }: { value: TouchKind; onChange: (next: TouchKind) => void }) {
  const { t } = useT()
  return (
    <FilterChoice<TouchKind>
      label={t('history.filterKind')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'all', label: t('history.everything') },
        { value: 'copied', label: t('history.onlyCopied') },
        { value: 'gone', label: t('history.onlyGone') },
        { value: 'trouble', label: t('history.onlyTrouble') },
      ]}
    />
  )
}
