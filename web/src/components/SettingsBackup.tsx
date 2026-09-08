import { useState } from 'react'

import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { IconDownload, IconUpload } from './glyphs'
import { api } from '../lib/api'
import { download, pickTextFile } from '../lib/download'
import { useT } from '../lib/i18n'

/**
 * Carrying the whole setup out to a file, and back in.
 *
 * It stood on the engine tab, between "how hard may it work" and "how long does
 * it remember", and it did not belong there: those are settings the engine
 * reads, and this is the file that holds all of them plus every job. jdp asked
 * for it by its old title and told it where to go: the general section, next to
 * the language, which is where somebody looks for what the program does with
 * itself rather than with their files.
 *
 * The two buttons are named for the acts rather than for the file
 * ("Einstellungen exportieren", "Einstellungen importieren"), and they wear the
 * sibling app's own pair: one box with the arrow reversed, which is the same
 * drawing twice and therefore a pair that cannot drift apart.
 *
 * The confirmation is the app's own window rather than the browser's. It was a
 * `window.confirm`, which is the one dialog in the program that no setting
 * reaches: not the theme, not the corner shape, not the accent. Rule 15 says a
 * window is a window no matter who renders it, and the sentence it asks is far
 * too consequential to be delivered in operating-system chrome.
 */
export function SettingsBackup({ hueIndex }: { hueIndex: number }) {
  const { t } = useT()
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The file waiting for a yes, held whole: reading it is not the act. */
  const [picked, setPicked] = useState<{ name: string; text: string } | null>(null)

  function replace(file: { name: string; text: string }) {
    setRestoring(true)
    setError(null)
    api
      .replaceConfig(file.text)
      // Reloaded rather than patched in place: this call replaced every job and
      // every setting on the machine, so everything the page is holding was read
      // from a configuration that no longer exists.
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
              // Named by the day rather than by a counter: a folder of backups
              // is only useful if the names say which is which, and a counter
              // needs somewhere to be kept.
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
          // Asked with the consequence in it. This replaces every job on the
          // machine, and the one thing nobody can do afterwards is get the old
          // file back.
          message={t('backup.confirm', { file: picked.name })}
          confirmLabel={t('backup.import')}
          confirmLabelKey="backup.import"
          confirmGlyph={<IconUpload />}
          cancelLabel={t('confirm.cancel')}
          // Warn rather than fail: nothing is broken, and one irreversible thing
          // is about to happen to a setup that took an evening to type.
          tone="warn"
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
