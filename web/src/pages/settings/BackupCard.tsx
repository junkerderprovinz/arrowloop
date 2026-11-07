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
import { importSections, type ImportPlan, type ImportSection } from '../../lib/importPlan'
import { SettingsRow } from './rows'

type Picked = { name: string; text: string }

/**
 * Exports the whole setup, every job and setting, to a file and imports it
 * back. The same Import takes a FolderSync export or a luckyBackup profile and
 * adds their jobs beside the ones already here.
 */
export function BackupCard({ hueIndex }: { hueIndex: number }) {
  const { t } = useT()
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** What a file from another program left out when it brought nothing to add. */
  const [leftOut, setLeftOut] = useState<ImportSection[]>([])
  /** Our own backup, waiting for confirmation. */
  const [picked, setPicked] = useState<Picked | null>(null)
  /** Another program's file and what it adds, waiting for confirmation. */
  const [preview, setPreview] = useState<(Picked & { plan: ImportPlan }) | null>(null)
  const exportButton = useRef<HTMLButtonElement>(null)
  // Keys the error, so each refused import remounts it and shakes again.
  const [refused, setRefused] = useState(0)

  function fail(message: string, sections: ImportSection[] = []) {
    setError(message)
    setLeftOut(sections)
    setRefused((n) => n + 1)
  }

  // Everything the page holds was read from the configuration that changed.
  const landed = () => window.location.reload()

  function replace(file: Picked) {
    setRestoring(true)
    setError(null)
    api
      .replaceConfig(file.text)
      .then(landed)
      .catch((e: Error) => fail(errorText(t, e)))
      .finally(() => setRestoring(false))
  }

  function add(file: Picked) {
    setRestoring(true)
    setError(null)
    api
      .applyImport(file.text)
      .then(landed)
      .catch((e: Error) => fail(errorText(t, e)))
      .finally(() => setRestoring(false))
  }

  // The engine tells the files apart by what is in them, not by their names.
  function look(file: Picked) {
    setRestoring(true)
    setError(null)
    setLeftOut([])
    api
      .checkImport(file.text)
      .then((plan) => {
        if (plan.source === 'ArrowLoop') setPicked(file)
        else if (plan.jobs.length === 0 && plan.targets.length === 0) fail(t('import.nothing'), importSections(plan, t))
        else setPreview({ ...file, plan })
      })
      .catch((e: Error) => fail(errorText(t, e)))
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
              .catch((e: Error) => fail(errorText(t, e)))
          }}
        />
      </SettingsRow>
      <div data-new="import-others">
        <SettingsRow label={t('settings.backupImportRow')}>
          <Button
            label={t('backup.import')}
            labelKey="backup.import"
            glyph={<IconImport />}
            busy={restoring}
            disabled={restoring}
            onClick={() => {
              void pickTextFile('.json,.profile,application/json,text/plain').then((file) => {
                if (file) look(file)
              })
            }}
          />
        </SettingsRow>
        <p className="text-subline text-carbon-textSub">{t('backup.importOthers')}</p>
      </div>
      {error && (
        <div key={refused} className="glim-shake text-subline">
          <p className="text-statusFail">{error}</p>
          <Sections sections={leftOut} />
        </div>
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

      {preview && (
        <ConfirmWindow
          title={t('import.title', { source: preview.plan.source })}
          message={t('import.confirm', { file: preview.name })}
          confirmLabel={t('import.add')}
          confirmLabelKey="import.add"
          confirmGlyph={<IconImport />}
          cancelLabel={t('confirm.cancel')}
          extra={<Sections sections={importSections(preview.plan, t)} />}
          onCancel={() => setPreview(null)}
          onConfirm={() => {
            const file = preview
            setPreview(null)
            add(file)
          }}
        />
      )}
    </Card>
  )
}

function Sections({ sections }: { sections: ImportSection[] }) {
  return sections.map((s) => (
    <section key={s.heading} className="mt-3 text-subline">
      <h3 className="font-semibold">{s.heading}</h3>
      <ul className="list-disc ps-5 break-words">
        {s.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </section>
  ))
}
