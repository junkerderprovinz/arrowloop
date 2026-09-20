import { useState } from 'react'

import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { IconDownload, IconUpload } from './glyphs'
import { api } from '../lib/api'
import { download, pickTextFile } from '../lib/download'
import { useT } from '../lib/i18n'

/** Exports the whole setup, every job and setting, to a file and imports it back. */
export function SettingsBackup({ hueIndex }: { hueIndex: number }) {
  const { t } = useT()
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The picked file, waiting for confirmation. */
  const [picked, setPicked] = useState<{ name: string; text: string } | null>(null)

  function replace(file: { name: string; text: string }) {
    setRestoring(true)
    setError(null)
    api
      .replaceConfig(file.text)
      // Everything the page holds was read from the replaced configuration.
      .then(() => window.location.reload())
      .catch((e: Error) => setError(e.message))
      .finally(() => setRestoring(false))
  }

  return (
    <Card title={t('backup.title')} hint={t('backup.hint')} hueIndex={hueIndex}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          label={t('backup.export')}
          labelKey="backup.export"
          glyph={<IconDownload />}
          tone="accent"
          onClick={() => {
            void api.rawConfig().then((doc) => {
              const day = new Date().toISOString().slice(0, 10)
              download(`arrowloop-${day}.json`, doc, 'application/json')
            })
          }}
        />
        <Button
          label={t('backup.import')}
          labelKey="backup.import"
          glyph={<IconUpload />}
          tone="accent"
          busy={restoring}
          disabled={restoring}
          onClick={() => {
            void pickTextFile('application/json,.json').then((file) => {
              if (!file) return
              setPicked(file)
            })
          }}
        />
        {error && <p className="text-xs text-statusFail">{error}</p>}
      </div>

      {picked && (
        <ConfirmDialog
          title={t('backup.import')}
          message={t('backup.confirm', { file: picked.name })}
          confirmLabel={t('backup.import')}
          confirmLabelKey="backup.import"
          confirmGlyph={<IconUpload />}
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
