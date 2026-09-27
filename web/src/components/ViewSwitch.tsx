import { Selector } from './Selector'
import { useT } from '../lib/i18n'

/** A log seen as its runs or as the files they touched. */
export type LogView = 'runs' | 'files'

/**
 * The switch between a log's runs and its files, one control for the History
 * tab and the small window at the tray icon, so both say it the same way.
 */
export function ViewSwitch({ value, onChange }: { value: LogView; onChange: (next: LogView) => void }) {
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
      ]}
    />
  )
}
