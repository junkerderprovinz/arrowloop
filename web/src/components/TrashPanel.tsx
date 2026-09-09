import { useCallback, useEffect, useState } from 'react'

import { bytes } from '../lib/bytes'
import { Button } from '../lib/glimstone/Button'
import { Selector } from './Selector'
import { NumberField } from './Field'
import { IconDelete, IconReset } from './glyphs'
import { IconAction } from './IconAction'
import { api, type TrashEntry } from '../lib/api'
import { useT } from '../lib/i18n'
import { Since } from '../pages/Jobs'

/**
 * What this job has put in the bin, and how to get it back.
 *
 * Nothing here is ever deleted outright: a file that disappears is moved into
 * the job's own reserved directory on the side that loses it. That has always
 * been true and was only ever half a promise, because the only way to look was
 * a file manager. This is the other half.
 *
 * Restoring refuses to overwrite something that is there now, and the refusal
 * comes from the server rather than from a check here: putting a file back is
 * the one operation in this app with no bin behind it, and a rule enforced by
 * the screen is a rule that does not apply to anything else talking to the API.
 */

type Side = 'left' | 'right'

export function TrashPanel({ job }: { job: string }) {
  const { t } = useT()
  const [side, setSide] = useState<Side>('left')
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [days, setDays] = useState(30)

  const look = useCallback(() => {
    setError(null)
    setEntries(null)
    api
      .trash(job, side)
      .then((r) => {
        setEntries(r.entries)
        setTotal(r.total)
      })
      .catch((e: Error) => setError(e.message))
  }, [job, side])

  useEffect(look, [look])

  return (
    <div className="flex flex-col gap-3">
      <Selector<Side>
        scale="small"
        label={t('trash.side')}
        value={side}
        onChange={(v) => {
          setNote(null)
          setSide(v)
        }}
        options={[
          { value: 'left', label: t('edit.left') },
          { value: 'right', label: t('edit.right') },
        ]}
      />

      {error && <p className="text-xs text-statusFail">{error}</p>}
      {note && <p className="text-xs text-statusOk">{note}</p>}

      {entries !== null && entries.length === 0 && (
        <p className="text-xs text-carbon-textMuted">{t('trash.empty')}</p>
      )}

      {/* How much this trash is holding, above the list.
          It lives inside the synced tree, so its size comes out of the same
          disk the job writes to, and "how much space is this costing me" was a
          question the interface could not answer at all - the list gave a count
          of paths and nothing else. Files and bytes together, because a
          thousand tiny files and one large one are different problems. */}
      {entries !== null && entries.length > 0 && (
        <p className="text-xs text-carbon-textMuted">
          {t('trash.holding', { count: entries.length, size: bytes(entries.reduce((n, e) => n + (e.size ?? 0), 0)) })}
        </p>
      )}

      {entries !== null && entries.length > 0 && (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {entries.map((e) => (
            <li key={e.remote} className="flex items-start gap-2 text-xs">
              <IconAction
                title={t('trash.restore')}
                labelKey="trash.restore"
                onClick={() => {
                  setBusy(true)
                  setError(null)
                  setNote(null)
                  api
                    .restoreTrash(job, side, e.path, e.runId)
                    .then(() => {
                      setNote(t('trash.restored', { path: e.path }))
                      look()
                    })
                    .catch((err: Error) => setError(err.message))
                    .finally(() => setBusy(false))
                }}
              >
                <IconReset />
              </IconAction>
              <span className="min-w-0 flex-1 break-all font-mono text-carbon-text" title={e.path}>
                {e.path}
              </span>
              {/* Null when the run id cannot be read, which is a real state and
                  not a bug: such an entry is listed so nothing is hidden, and
                  it is never pruned by age because its age is unknown. */}
              <span className="shrink-0 text-carbon-textMuted">
                {e.filed ? <Since when={e.filed} /> : t('trash.unknownAge')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {total > (entries?.length ?? 0) && (
        <p className="text-xs text-carbon-textMuted">
          {t('trash.more', { total, shown: entries?.length ?? 0 })}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <NumberField value={days} min={1} max={3650} label={t('trash.days')} onChange={setDays} />
        <Button
          label={t('trash.prune')}
          labelKey="trash.prune"
          glyph={<IconDelete />}
          busy={busy}
          disabled={busy}
          onClick={() => {
            // Asked before, and asked with the consequence in it: this is the
            // one button on the page that removes something the bin cannot get
            // back, because the bin is what it is emptying.
            if (!window.confirm(t('trash.pruneConfirm', { days }))) return
            setBusy(true)
            setError(null)
            api
              .pruneTrash(job, side, days)
              .then((r) => {
                setNote(t('trash.pruned', { entries: r.entries }))
                look()
              })
              .catch((err: Error) => setError(err.message))
              .finally(() => setBusy(false))
          }}
        />
      </div>
    </div>
  )
}
