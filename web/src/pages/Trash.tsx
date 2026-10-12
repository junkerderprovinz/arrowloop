import { useState } from 'react'

import { Empty, Num, Rows, Stack } from '../components/Shell'
import { Field, NumberField } from '../components/Field'
import { IconAction } from '../components/IconAction'
import { JobChip } from '../components/JobChip'
import { PageAction, PageActions } from '../components/PageActions'
import { Since } from '../components/Since'
import { IconHistory, IconTrash } from '../components/glyphs'
import { Card } from '../lib/glimstone/Card'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { api, type TrashEntry, type TrashSide } from '../lib/api'
import { bytes } from '../lib/bytes'
import { byJob, trashTotals } from '../lib/trashView'
import { translateSide, useT, type TranslationKey } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { errorText } from '../lib/errorText'

/** What a confirmation is about to remove for good. */
type Pending =
  | { kind: 'entry'; side: TrashSide; entry: TrashEntry }
  | { kind: 'side'; side: TrashSide }
  | { kind: 'all'; sides: TrashSide[] }
  | { kind: 'prune'; sides: TrashSide[] }

/**
 * Every job's trash on both sides, in a card per job. Restoring is a click,
 * since it only moves a file back; removing anything for good asks first,
 * because the trash is the last copy there is. Emptying it is the corner's
 * filled action, with deleting only the old entries beside it; both act on
 * the jobs the page shows.
 */
export function Trash({
  sides,
  job,
  onJob,
  onChanged,
}: {
  /** Null until the first answer arrives. */
  sides: TrashSide[] | null
  /** The job the address narrows the page to, empty for every job. */
  job: string
  /** Narrows the page to another job, by changing the address. */
  onJob: (job: string) => void
  /** Asks for a job's trash again after something in it changed. */
  onChanged: (job: string) => void
}) {
  const { t } = useT()
  const push = useToast()
  const [days, setDays] = useState(30)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)

  const all = sides ?? []
  const shown = job ? all.filter((s) => s.job === job) : all
  const readable = shown.filter((s) => !s.error)
  const totals = trashTotals(readable)

  // Runs one change after another and asks for each touched job again. The
  // first refusal stops the rest, since it usually means the same for them.
  async function act(work: { job: string; run: () => Promise<unknown> }[], done: () => string) {
    setBusy(true)
    const touched = new Set<string>()
    try {
      for (const w of work) {
        touched.add(w.job)
        await w.run()
      }
      push(done())
    } catch (e) {
      push(errorText(t, e), 'fail')
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
        void act([{ job: p.side.job, run: () => api.emptyTrash(p.side.job, p.side.side, p.side.mark) }], () =>
          t('trash.emptied', { count: p.side.total }),
        )
        break
      case 'all':
        void act(
          p.sides.map((s) => ({ job: s.job, run: () => api.emptyTrash(s.job, s.side, s.mark) })),
          () => t('trash.emptied', { count: trashTotals(p.sides).entries }),
        )
        break
      case 'prune': {
        let removed = 0
        void act(
          p.sides.map((s) => ({
            job: s.job,
            run: async () => {
              removed += (await api.pruneTrash(s.job, s.side, days, s.mark)).entries
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

  const full = readable.filter((s) => s.total > 0)

  return (
    <Stack>
      <JobChip job={job} onClear={() => onJob('')} />

      {sides === null || (totals.entries === 0 && shown.every((s) => !s.error)) ? (
        <Card title={t('nav.trash')} hueIndex={0} hint={t('trash.hint')}>
          <Empty>{sides === null ? t('history.working') : job ? t('trash.nothingInJob') : t('trash.nothing')}</Empty>
        </Card>
      ) : (
        byJob(shown)
          .filter((group) => group.sides.some((s) => s.total > 0 || s.error))
          .map((group, i) => (
            <Card key={group.job} title={group.job} hueIndex={i} hint={t('trash.hint')}>
              <div className="glim-content-fade flex flex-col gap-6">
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
              </div>
            </Card>
          ))
      )}

      {pending && (
        <ConfirmDialog
          title={t(TITLES[pending.kind])}
          message={stakes(pending, t)}
          confirmLabel={pending.kind === 'entry' ? t('confirm.delete') : t(TITLES[pending.kind])}
          confirmLabelKey={pending.kind === 'entry' ? 'confirm.delete' : TITLES[pending.kind]}
          confirmGlyph={<IconTrash />}
          cancelLabel={t('confirm.cancel')}
          // The age belongs to this one action, so it is asked here.
          extra={
            pending.kind === 'prune' ? (
              <Field label={t('trash.days')}>
                <NumberField value={days} min={1} max={3650} label={t('trash.days')} onChange={setDays} />
              </Field>
            ) : undefined
          }
          onCancel={() => setPending(null)}
          onConfirm={() => confirmed(pending)}
        />
      )}

      <PageActions>
        <span data-new="trash-actions">
          <PageAction
            label={t('trash.prune')}
            labelKey="trash.prune"
            glyph={<IconHistory />}
            title={t('trash.pruneHint')}
            disabled={busy || totals.entries === 0}
            onClick={() => setPending({ kind: 'prune', sides: full })}
          />
        </span>
        <PageAction
          primary
          label={t('trash.emptyAll')}
          labelKey="trash.emptyAll"
          glyph={<IconTrash />}
          disabled={busy || totals.entries === 0}
          onClick={() => setPending({ kind: 'all', sides: full })}
        />
      </PageActions>
    </Stack>
  )
}

/** A confirmation's title, which names the action that opened it. */
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
      return t('trash.pruneQuestion')
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
    <section className="flex flex-col gap-1">
      <div className="glim-row flex min-h-9 items-center gap-3">
        <h3 className="glim-eyebrow">{t(side.side === 'left' ? 'edit.left' : 'edit.right')}</h3>
        {!side.error && (
          <span className="glim-num text-meta text-carbon-textMuted">
            {t('trash.holding', { count: side.total, size: bytes(side.bytes) })}
          </span>
        )}
        {!side.error && (
          <span className="glim-row-actions ms-auto">
            <IconAction title={t('trash.emptySide')} labelKey="trash.emptySide" disabled={busy} onClick={onEmpty} />
          </span>
        )}
      </div>

      {side.error ? (
        <p className="text-subline text-statusFail">{t('trash.unread', { error: side.error })}</p>
      ) : (
        <Rows className="-mx-2 flex flex-col">
          {side.entries.map((e) => (
            <li key={e.remote} className="glim-row flex min-h-10 items-center gap-3 rounded-control px-2 text-subline hover:bg-carbon-hover">
              <span className="min-w-0 flex-1 truncate font-mono text-carbon-text" title={e.remote}>
                {e.path}
              </span>
              {/* A file somebody put there by hand has no run, and the engine
                  names an entry by its run, so only emptying reaches it. */}
              <span className="glim-row-actions flex shrink-0 items-center gap-1.5">
                <IconAction
                  title={t('trash.delete')}
                  labelKey="trash.delete"
                  disabled={busy || !e.runId}
                  onClick={() => onDelete(e)}
                />
                <IconAction
                  title={t('trash.restore')}
                  labelKey="trash.restore"
                  disabled={busy || !e.runId}
                  onClick={() => onRestore(e)}
                />
              </span>
              <span className="shrink-0 text-carbon-textMuted max-sm:hidden">
                <Num>{bytes(e.size)}</Num>
              </span>
              {/* No date when the run id cannot be read; such an entry is never
                  pruned by age. */}
              <span className="w-28 shrink-0 text-end text-carbon-textMuted">
                {e.filed ? <Since when={e.filed} /> : t('trash.unknownAge')}
              </span>
            </li>
          ))}
        </Rows>
      )}

      {side.total > side.entries.length && (
        <p className="text-subline text-carbon-textMuted">{t('trash.more', { total: side.total, shown: side.entries.length })}</p>
      )}
    </section>
  )
}
