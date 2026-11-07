import { useEffect, useState } from 'react'

import { ConfirmWindow } from '../../components/ConfirmWindow'
import { FieldRow, NumberField, Text } from '../../components/Field'
import { IconImport } from '../../components/glyphs'
import { Since } from '../../components/Since'
import { ToggleRow } from '../../components/ToggleRow'
import { api, type AutoBackups, type Settings } from '../../lib/api'
import { errorText } from '../../lib/errorText'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { Reading, useEngineSettings } from './engineSettings'
import { SettingsRow } from './rows'

/**
 * The copies of the setup the engine keeps on its own, and the newest of them
 * put back through the same import a file from Export settings goes through.
 */
export function AutoBackupCard({ hueIndex }: { hueIndex: number }) {
  const { t, lang } = useT()
  const { loaded, draft, patch, error } = useEngineSettings()
  const [state, setState] = useState<AutoBackups | null>(null)
  const [asking, setAsking] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

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

  function restore(name: string) {
    setRestoring(true)
    setRefused(null)
    api
      .autoBackup(name)
      .then((doc) => api.replaceConfig(doc))
      // Everything the page holds was read from the replaced configuration.
      .then(() => window.location.reload())
      .catch((e: Error) => setRefused(errorText(t, e)))
      .finally(() => setRestoring(false))
  }

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
            <SettingsRow label={t('autoBackup.keep')} hint={t('autoBackup.keepHint')}>
              <NumberField
                value={auto.keep ?? 7}
                min={1}
                max={1000}
                label={t('autoBackup.keep')}
                onChange={(keep) => set({ keep })}
              />
            </SettingsRow>
            <FieldRow label={t('autoBackup.folder')} hint={t('autoBackup.folderHint')}>
              <Text
                value={auto.folder ?? ''}
                onChange={(folder) => set({ folder })}
                placeholder={auto.folder ? '' : state?.folder}
                label={t('autoBackup.folder')}
                mono
              />
            </FieldRow>
          </>
        )}
        <SettingsRow label={t('autoBackup.latest')}>
          <span className="flex items-center gap-3">
            <span className="text-body text-carbon-textSub">
              {latest ? <Since when={latest.made} /> : t('autoBackup.none')}
            </span>
            {latest && (
              <Button
                label={t('autoBackup.restore')}
                labelKey="autoBackup.restore"
                glyph={<IconImport />}
                busy={restoring}
                disabled={restoring}
                onClick={() => setAsking(true)}
              />
            )}
          </span>
        </SettingsRow>
        {failed && <p className="text-subline text-statusFail">{t('autoBackup.failed', { error: failed })}</p>}
        {refused && <p className="glim-shake text-subline text-statusFail">{refused}</p>}

        {asking && latest && (
          <ConfirmWindow
            title={t('autoBackup.restore')}
            message={
              // The engine keeps the setup it replaces only while backups are on.
              on
                ? t('autoBackup.confirm', { when: new Date(latest.made).toLocaleString(lang) })
                : t('backup.confirm', { file: latest.name })
            }
            confirmLabel={t('autoBackup.restore')}
            confirmLabelKey="autoBackup.restore"
            confirmGlyph={<IconImport />}
            cancelLabel={t('confirm.cancel')}
            onCancel={() => setAsking(false)}
            onConfirm={() => {
              setAsking(false)
              restore(latest.name)
            }}
          />
        )}
      </Card>
    </div>
  )
}
