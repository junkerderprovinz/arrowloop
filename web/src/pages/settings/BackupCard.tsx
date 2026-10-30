import { useRef, useState } from 'react'

import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { ConfirmWindow } from '../../components/ConfirmWindow'
import { IconExport, IconImport } from '../../components/glyphs'
import { replay } from '../../lib/animate'
import { api } from '../../lib/api'
import { download, pickTextFile } from '../../lib/download'
import { errorText } from '../../lib/errorText'
import { useT } from '../../lib/i18n'
import { SettingsRow } from './rows'

/** Exports the whole setup, every job and setting, to a file and imports it back. */
export function BackupCard({ hueIndex }: { hueIndex: number }) {
  const { t } = useT()
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The picked file, waiting for confirmation. */
  const [picked, setPicked] = useState<{ name: string; text: string } | null>(null)
  const exportButton = useRef<HTMLButtonElement>(null)
  // Keys the error, so each refused import remounts it and shakes again.
  const [refused, setRefused] = useState(0)

  function replace(file: { name: string; text: string }) {
    setRestoring(true)
    setError(null)
    api
      .replaceConfig(file.text)
      // Everything the page holds was read from the replaced configuration.
      .then(() => window.location.reload())
      .catch((e: Error) => {
        setError(errorText(t, e))
        setRefused((n) => n + 1)
      })
      .finally(() => setRestoring(false))
  }

  return (
    <Card title={t('backup.title')} hint={t('backup.hint')} hueIndex={hueIndex}>
      {/* Neutral: the one filled accent on a page belongs to its main action,
          and neither of these is what Settings exists for. */}
      <SettingsRow label={t('settings.backupExportRow')}>
        <Button
          label={t('backup.export')}
          labelKey="backup.export"
          glyph={<IconExport />}
          ref={exportButton}
          onClick={() => {
            void api
              .rawConfig()
              .then((doc) => {
                const day = new Date().toISOString().slice(0, 10)
                download(`arrowloop-${day}.json`, doc, 'application/json')
                replay(exportButton.current, 'glim-confirm')
              })
              .catch((e: Error) => {
                setError(errorText(t, e))
                setRefused((n) => n + 1)
              })
          }}
        />
      </SettingsRow>
      <SettingsRow label={t('settings.backupImportRow')}>
        <Button
          label={t('backup.import')}
          labelKey="backup.import"
          glyph={<IconImport />}
          busy={restoring}
          disabled={restoring}
          onClick={() => {
            void pickTextFile('application/json,.json').then((file) => {
              if (!file) return
              setPicked(file)
            })
          }}
        />
      </SettingsRow>
      {error && (
        <p key={refused} className="glim-shake text-subline text-statusFail">
          {error}
        </p>
      )}

      {picked && (
        <ConfirmWindow
          title={t('backup.import')}
          message={t('backup.confirm', { file: picked.name })}
          confirmLabel={t('backup.import')}
          confirmLabelKey="backup.import"
          confirmGlyph={<IconImport />}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setPicked(null)}
          onConfirm={() => {
            const file = picked
            setPicked(null)
            replace(file)
          }}
        />
      )}
    </Card>
  )
}
