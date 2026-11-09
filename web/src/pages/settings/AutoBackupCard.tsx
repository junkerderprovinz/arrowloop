import { useEffect, useState } from 'react'

import { FolderPicker } from '../../components/FolderPicker'
import { FieldRow, NumberField, Text } from '../../components/Field'
import { IconFolder } from '../../components/glyphs'
import { Since } from '../../components/Since'
import { TimePicker } from '../../components/TimePicker'
import { ToggleRow } from '../../components/ToggleRow'
import { api, type AutoBackups, type Settings } from '../../lib/api'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { Reading, useEngineSettings } from './engineSettings'
import { SettingsRow } from './rows'

/** The copies of the setup the engine keeps on its own. */
export function AutoBackupCard({ hueIndex }: { hueIndex: number }) {
  const { t } = useT()
  const { loaded, draft, patch, error } = useEngineSettings()
  const [state, setState] = useState<AutoBackups | null>(null)
  const [picking, setPicking] = useState(false)

  // Read again after every save, since a new folder or a smaller count
  // changes what is there.
  useEffect(() => {
    api.autoBackups().then(setState, () => setState(null))
  }, [loaded])

  if (!loaded) return <Reading title={t('autoBackup.title')} error={error} hueIndex={hueIndex} />

  const auto = draft.autoBackup ?? {}
  const set = (next: NonNullable<Settings['autoBackup']>) => patch({ autoBackup: { ...auto, ...next } })
  const on = !auto.off
  const latest = state?.files[0]
  const failed = state?.last?.error

  return (
    <div data-new="auto-backup">
      <Card title={t('autoBackup.title')} hint={t('autoBackup.hint')} hueIndex={hueIndex}>
        <ToggleRow label={t('autoBackup.on')} checked={on} onChange={(next) => set({ off: !next })} />
        {/* Absent rather than dimmed while it is off, as the anomaly notes. */}
        {on && (
          <>
            <SettingsRow label={t('autoBackup.everyDays')} hint={t('autoBackup.everyDaysHint')}>
              <NumberField
                value={auto.everyDays ?? 1}
                min={1}
                max={365}
                label={t('autoBackup.everyDays')}
                onChange={(everyDays) => set({ everyDays })}
              />
            </SettingsRow>
            <SettingsRow label={t('autoBackup.at')} hint={t('autoBackup.atHint')}>
              <TimePicker value={auto.at ?? '03:00'} label={t('autoBackup.at')} onChange={(at) => set({ at })} />
            </SettingsRow>
            <SettingsRow label={t('autoBackup.keep')} hint={t('autoBackup.keepHint')}>
              <NumberField
                value={auto.keep ?? 7}
                min={1}
                max={1000}
                label={t('autoBackup.keep')}
                onChange={(keep) => set({ keep })}
              />
            </SettingsRow>
            <FieldRow label={t('autoBackup.folder')} hint={t('autoBackup.folderHint')} width="w-[31rem]">
              <span className="flex w-full flex-wrap items-center gap-2 [&>input]:min-w-[12rem] [&>input]:flex-1">
                <Text
                  value={auto.folder ?? ''}
                  onChange={(folder) => set({ folder })}
                  placeholder={auto.folder ? '' : state?.folder}
                  label={t('autoBackup.folder')}
                  mono
                />
                <Button label={t('pick.title')} labelKey="pick.title" glyph={<IconFolder />} onClick={() => setPicking(true)} />
              </span>
              <FolderPicker
                open={picking}
                start={auto.folder || state?.folder}
                onClose={() => setPicking(false)}
                onPick={(folder) => {
                  set({ folder })
                  setPicking(false)
                }}
              />
            </FieldRow>
          </>
        )}
        <SettingsRow label={t('autoBackup.latest')}>
          <span className="text-body text-carbon-textSub">{latest ? <Since when={latest.made} /> : t('autoBackup.none')}</span>
        </SettingsRow>
        {failed && <p className="text-subline text-statusFail">{t('autoBackup.failed', { error: failed })}</p>}
      </Card>
    </div>
  )
}
