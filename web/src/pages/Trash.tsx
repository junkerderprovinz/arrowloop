import { useState } from 'react'

import { Empty, Num, Rows, Rule, Stack } from '../components/Shell'
import { Choice, Field, NumberField } from '../components/Field'
import { IconAction } from '../components/IconAction'
import { IconDelete } from '../components/glyphs'
import { Card } from '../lib/glimstone/Card'
import { Button } from '../lib/glimstone/Button'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { api, type TrashEntry, type TrashSide } from '../lib/api'
import { bytes } from '../lib/bytes'
import { byJob, trashTotals } from '../lib/trashView'
import { translateSide, useT, type TranslationKey } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { Since } from './Jobs'

/** What a confirmation is about to remove for good. */
type Pending =
  | { kind: 'entry'; side: TrashSide; entry: TrashEntry }
  | { kind: 'side'; side: TrashSide }
  | { kind: 'all'; sides: TrashSide[] }
  | { kind: 'prune'; sides: TrashSide[]; days: number }

/**
 * Every job's trash on both sides. Restoring is a click, since it only moves a
 * file back; removing anything for good asks first, because the trash is the
 * last copy there is.
 */
export function Trash({
  sides,
  job: startJob,
  onChanged,
}: {
  /** Null until the first answer arrives. */
  sides: TrashSide[] | null
  /** The job to show first, when another screen sent somebody here for one. */
  job: string
  /** Asks for a job's trash again after something in it changed. */
  onChanged: (job: string) => void
}) {
  const { t } = useT()
  const push = useToast()
  const [job, setJob] = useState(startJob)
  const [days, setDays] = useState(30)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const all = sides ?? []
  const shown = job ? all.filter((s) => s.job === job) : all
  const readable = shown.filter((s) => !s.error)
  const totals = trashTotals(readable)
  const names = [...new Set([...all.map((s) => s.job), ...(job ? [job] : [])])]

  // Runs one change after another and asks for each touched job again. The
  // first refusal stops the rest, since it usually means the same for them.
  async function act(work: { job: string; run: () => Promise<unknown> }[], done: () => string) {
    setBusy(true)
    setError(null)
    const touched = new Set<string>()
    try {
      for (const w of work) {
        touched.add(w.job)
        await w.run()
      }
      push(done())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      touched.forEach(onChanged)
      setBusy(false)
    }
  }

  function confirmed(p: Pending) {
    setPending(null)
    switch (p.kind) {
      case 'entry':
        void act(
          [{ job: p.side.job, run: () => api.deleteTrash(p.side.job, p.side.side, p.entry.path, p.entry.runId) }],
          () => t('trash.deleted', { path: p.entry.path }),
        )
        break
      case 'side':
        void act([{ job: p.side.job, run: () => api.emptyTrash(p.side.job, p.side.side) }], () =>
          t('trash.emptied', { count: p.side.total }),
        )
        break
      case 'all':
        void act(
          p.sides.map((s) => ({ job: s.job, run: () => api.emptyTrash(s.job, s.side) })),
          () => t('trash.emptied', { count: trashTotals(p.sides).entries }),
        )
        break
      case 'prune': {
        let removed = 0
        void act(
          p.sides.map((s) => ({
            job: s.job,
            run: async () => {
              removed += (await api.pruneTrash(s.job, s.side, p.days)).entries
            },
          })),
          () => t('trash.pruned', { entries: removed }),
        )
        break
      }
    }
  }

  function restore(side: TrashSide, entry: TrashEntry) {
    void act(
      [{ job: side.job, run: () => api.restoreTrash(side.job, side.side, entry.path, entry.runId) }],
      () => t('trash.restored', { path: entry.path }),
    )
  }

  return (
    <Stack>
      <Card title={t('nav.trash')} hueIndex={0} hint={t('trash.hint')}>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-56 shrink-0">
            <Choice
              label={t('history.filterJob')}
              value={job}
              onChange={setJob}
              options={[{ value: '', label: t('history.allJobs') }, ...names.map((n) => ({ value: n, label: n }))]}
            />
          </div>
          <span className="glim-num pb-2 text-xs text-carbon-textMuted">
            {t('trash.holding', { count: totals.entries, size: bytes(totals.bytes) })}
          </span>
          <div className="ms-auto flex flex-wrap items-end justify-end gap-2">
            <Field label={t('trash.days')}>
              <NumberField value={days} min={1} max={3650} label={t('trash.days')} onChange={setDays} />
            </Field>
            <Button
              label={t('trash.prune')}
              labelKey="trash.prune"
              busy={busy}
              disabled={busy || totals.entries === 0}
              onClick={() => setPending({ kind: 'prune', sides: readable.filter((s) => s.total > 0), days })}
            />
            <Button
              label={t('trash.emptyAll')}
              labelKey="trash.emptyAll"
              busy={busy}
              disabled={busy || totals.entries === 0}
              onClick={() => setPending({ kind: 'all', sides: readable.filter((s) => s.total > 0) })}
            />
          </div>
        </div>

        {error && <p className="mb-3 text-xs text-statusFail">{error}</p>}

        {sides === null ? (
          <Empty>{t('history.working')}</Empty>
        ) : totals.entries === 0 && shown.every((s) => !s.error) ? (
          <Empty>{job ? t('trash.nothingInJob') : t('trash.nothing')}</Empty>
        ) : (
          <div className="glim-content-fade flex flex-col gap-6">
            {byJob(shown).map((group) => (
              <section key={group.job} className="flex flex-col gap-4">
                {group.sides
                  .filter((s) => s.total > 0 || s.error)
                  .map((s) => (
                    <SideList
                      key={s.side}
                      side={s}
                      busy={busy}
                      onRestore={(entry) => restore(s, entry)}
                      onDelete={(entry) => setPending({ kind: 'entry', side: s, entry })}
                      onEmpty={() => setPending({ kind: 'side', side: s })}
                    />
                  ))}
              </section>
            ))}
          </div>
        )}
      </Card>

      {pending && (
        <ConfirmDialog
          title={t(TITLES[pending.kind])}
          message={stakes(pending, t)}
          confirmLabel={pending.kind === 'entry' ? t('confirm.delete') : t(TITLES[pending.kind])}
          confirmGlyph={<IconDelete />}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setPending(null)}
          onConfirm={() => confirmed(pending)}
        />
      )}
    </Stack>
  )
}

/** A confirmation's title, which names the button that opened it. */
const TITLES: Record<Pending['kind'], TranslationKey> = {
  entry: 'trash.delete',
  side: 'trash.emptySide',
  all: 'trash.emptyAll',
  prune: 'trash.prune',
}

/** The sentence a confirmation asks, with the count and size at stake. */
function stakes(p: Pending, t: ReturnType<typeof useT>['t']): string {
  switch (p.kind) {
    case 'entry':
      return t('trash.deleteConfirm', { path: p.entry.path })
    case 'side':
      return t('trash.emptySideConfirm', {
        job: p.side.job,
        side: translateSide(t, p.side.side as 'left' | 'right'),
        count: p.side.total,
        size: bytes(p.side.bytes),
      })
    case 'all': {
      const { entries, bytes: size } = trashTotals(p.sides)
      return t('trash.emptyAllConfirm', { count: entries, size: bytes(size) })
    }
    case 'prune':
      return t('trash.pruneAsk', { days: p.days })
  }
}

function SideList({
  side,
  busy,
  onRestore,
  onDelete,
  onEmpty,
}: {
  side: TrashSide
  busy: boolean
  onRestore: (entry: TrashEntry) => void
  onDelete: (entry: TrashEntry) => void
  onEmpty: () => void
}) {
  const { t } = useT()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-carbon-textMuted">
          {side.job} · {t(side.side === 'left' ? 'edit.left' : 'edit.right')}
        </span>
        {!side.error && (
          <span className="glim-num text-xs text-carbon-textMuted">
            {t('trash.holding', { count: side.total, size: bytes(side.bytes) })}
          </span>
        )}
        {!side.error && (
          <div className="ms-auto">
            <Button label={t('trash.emptySide')} labelKey="trash.emptySide" disabled={busy} onClick={onEmpty} />
          </div>
        )}
      </div>

      {side.error ? (
        <p className="text-xs text-statusFail">{t('trash.unread', { error: side.error })}</p>
      ) : (
        <Rows className="flex flex-col">
          {side.entries.map((e, i) => (
            <li key={e.remote}>
              {i > 0 && <Rule />}
              <div className="flex items-center gap-3 py-1.5 text-xs">
                <span className="min-w-0 flex-1 break-all font-mono text-carbon-text" title={e.remote}>
                  {e.path}
                </span>
                <span className="shrink-0 text-carbon-textMuted">
                  <Num>{bytes(e.size)}</Num>
                </span>
                {/* No date when the run id cannot be read; such an entry is never
                    pruned by age. */}
                <span className="w-28 shrink-0 text-end text-carbon-textMuted">
                  {e.filed ? <Since when={e.filed} /> : t('trash.unknownAge')}
                </span>
                {/* Grey, since an action on every row marks no activity. A file
                    somebody put there by hand has no run, and the engine
                    names an entry by its run, so only emptying reaches it. */}
                <IconAction
                  title={t('trash.delete')}
                  labelKey="trash.delete"
                  tone="subtle"
                  disabled={busy || !e.runId}
                  onClick={() => onDelete(e)}
                />
                <IconAction
                  title={t('trash.restore')}
                  labelKey="trash.restore"
                  tone="subtle"
                  disabled={busy || !e.runId}
                  onClick={() => onRestore(e)}
                />
              </div>
            </li>
          ))}
        </Rows>
      )}

      {side.total > side.entries.length && (
        <p className="text-xs text-carbon-textMuted">{t('trash.more', { total: side.total, shown: side.entries.length })}</p>
      )}
    </div>
  )
}
