import { Selector } from './Selector'
import { useT } from '../lib/i18n'

/** A log seen as its runs, as the files they touched, or as the findings closed lately. */
export type LogView = 'runs' | 'files' | 'findings'

/**
 * The switch between a log's runs and its files, one control for the History
 * tab and the small window at the tray icon, so both say it the same way.
 * History adds the closed findings, which the tray window leaves out.
 */
export function ViewSwitch({
  value,
  onChange,
  findings = false,
}: {
  value: LogView
  onChange: (next: LogView) => void
  findings?: boolean
}) {
  const { t } = useT()
  return (
    <Selector<LogView>
      scale="small"
      label={t('history.filterShow')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'runs', label: t('history.runs') },
        { value: 'files', label: t('history.files') },
        ...(findings ? [{ value: 'findings' as const, label: t('history.findings') }] : []),
      ]}
    />
  )
}
