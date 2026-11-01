import { useRef, useState } from 'react'

import { Empty, Num, Rows, Stack } from '../components/Shell'
import { Field, NumberField } from '../components/Field'
import { IconAction } from '../components/IconAction'
import { JobChip } from '../components/JobChip'
import { FilterChoice, ListHead, ListSearch, Narrowed, type Head, type ListSort } from '../components/ListHead'
import { PageAction, PageActions } from '../components/PageActions'
import { Since } from '../components/Since'
import { IconEmpty, IconPrune, IconTrash } from '../components/glyphs'
import { Tiles } from '../components/Tiles'
import { Card } from '../lib/glimstone/Card'
import { ConfirmWindow } from '../components/ConfirmWindow'
import { api, type TrashEntry, type TrashSide } from '../lib/api'
import { bytes } from '../lib/bytes'
import { matchesQuery } from '../lib/fold'
import { useRemembered } from '../lib/remember'
import { byJob, trashTotals } from '../lib/trashView'
import { translateSide, useT, type TranslationKey } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { errorText } from '../lib/errorText'
import { failureLine } from '../lib/failure'

/** What a confirmation is about to remove for good. */
type Pending =
  | { kind: 'entry'; side: TrashSide; entry: TrashEntry }
  | { kind: 'side'; side: TrashSide }
  | { kind: 'all'; sides: TrashSide[] }
  | { kind: 'prune'; sides: TrashSide[] }

const SORTS = ['path', 'size', 'age'] as const
const isSort = (v: unknown): v is ListSort | null =>
  v === null ||
  (typeof v === 'object' &&
    SORTS.includes((v as ListSort).by as (typeof SORTS)[number]) &&
    ((v as ListSort).dir === 'asc' || (v as ListSort).dir === 'desc'))

/** The entries in the order a head asked for. Ascending age is the newest first, as a day count reads. */
function sorted(entries: TrashEntry[], sort: ListSort | null): TrashEntry[] {
  if (!sort) return entries
  const sign = sort.dir === 'asc' ? 1 : -1
  const filed = (e: TrashEntry) => (e.filed ? Date.parse(e.filed) : 0)
  return [...entries].sort((a, b) => {
    if (sort.by === 'size') return sign * (a.size - b.size)
    if (sort.by === 'age') return sign * (filed(b) - filed(a))
    return sign * a.path.localeCompare(b.path)
  })
}

/**
 * Every job's trash on both sides, in a card per job under the tiles that
 * count it, which pick both sides or one; the heads pick the job. Restoring is
 * a click, since it only moves a file back; removing anything for good asks
 * first, because the trash is the last copy there is. Emptying it is the
 * corner's filled action, with deleting only the old entries beside it; both
 * act on the jobs the page shows. The lists sort from their heads, and typing
 * searches their paths.
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
  const [sort, setSort] = useRemembered<ListSort | null>('arrowloop.trash.sort', null, isSort)
  const [query, setQuery] = useState('')
  // The side a tile picked, empty for both.
  const [tile, setTile] = useState<'' | 'left' | 'right'>('')
  // The job the head's filter picked, empty for every job.
  const [only, setOnly] = useState('')
  const area = useRef<HTMLDivElement>(null)

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

  const searching = query.trim() !== ''
  const matching = (s: TrashSide) => (searching ? s.entries.filter((e) => matchesQuery(query, [e.path])) : s.entries)
  const names = byJob(readable)
    .filter((group) => group.sides.some((s) => s.total > 0))
    .map((group) => group.job)
  const picked = names.includes(only) ? only : ''
  const ofJob = readable.filter((s) => !picked || s.job === picked)
  // The corner's two actions act on what the tiles and the job filter show.
  const full = ofJob.filter((s) => s.total > 0 && (!tile || s.side === tile))
  const groups = byJob(shown)
    .filter((group) => !picked || group.job === picked)
    .map((group) => ({
      ...group,
      sides: group.sides.filter((s) => (!tile || s.side === tile) && (s.error || (s.total > 0 && matching(s).length > 0))),
    }))
    .filter((group) => group.sides.length > 0)
  const holding = (sides: TrashSide[]) => {
    const { entries, bytes: size } = trashTotals(sides)
    return { count: entries, detail: t('trash.holding', { count: entries, size: bytes(size) }) }
  }
  const jobHead: Head = {
    id: 'job',
    label: t('history.filterJob'),
    className: 'shrink-0',
    filter: {
      active: picked !== '',
      panel: (
        <FilterChoice
          label={t('history.filterJob')}
          value={picked}
          onChange={setOnly}
          options={[{ value: '', label: t('history.allJobs') }, ...names.map((n) => ({ value: n, label: n }))]}
        />
      ),
    },
  }
  const narrowing = [
    ...(picked ? [t('list.onlyJob', { job: picked })] : []),
    ...(searching ? [t('list.searched', { q: query.trim() })] : []),
  ]

  return (
    <Stack>
      <JobChip job={job} onClear={() => onJob('')} />

      {sides === null || (totals.entries === 0 && shown.every((s) => !s.error)) ? (
        <div data-new="trash-bin">
          <Card title={t('nav.trash')} hueIndex={0} hint={t('trash.hint')}>
            <Empty>{sides === null ? t('history.working') : job ? t('trash.nothingInJob') : t('trash.nothing')}</Empty>
          </Card>
        </div>
      ) : (
        <>
          <div data-new="trash-bin">
            <div data-new="tile-rows">
              <Tiles
                label={t('nav.trash')}
                glyph={<IconTrash />}
                tiles={[
                  { id: '' as const, label: t('trash.all'), ...holding(ofJob) },
                  { id: 'left' as const, label: t('edit.left'), ...holding(ofJob.filter((s) => s.side === 'left')) },
                  { id: 'right' as const, label: t('edit.right'), ...holding(ofJob.filter((s) => s.side === 'right')) },
                ]}
                chosen={tile}
                onChoose={setTile}
              >
                <Narrowed
                  what={narrowing}
                  onClear={() => {
                    setOnly('')
                    setQuery('')
                  }}
                />
              </Tiles>
            </div>
          </div>
          <div ref={area} tabIndex={-1} className="relative flex flex-col gap-10 outline-none">
            <ListSearch value={query} onChange={setQuery} placeholder={t('history.pathHint')} area={area} />
            {groups.length === 0 && (
              <Card hueIndex={1}>
                <Empty>{searching ? t('jobs.historyNoMatch', { q: query.trim() }) : t('list.noneShown')}</Empty>
              </Card>
            )}
            {groups.map((group, i) => (
              <Card key={group.job} title={group.job} hueIndex={i + 1} hint={t('trash.hint')}>
                <div className="glim-content-fade flex flex-col gap-6">
                  {group.sides.map((s, at) => (
                    <SideList
                      key={s.side}
                      side={s}
                      entries={sorted(matching(s), sort)}
                      busy={busy}
                      sort={sort ?? undefined}
                      onSort={setSort}
                      tip={i === 0 && at === 0}
                      jobHead={i === 0 && at === 0 ? jobHead : undefined}
                      onRestore={(entry) => restore(s, entry)}
                      onDelete={(entry) => setPending({ kind: 'entry', side: s, entry })}
                      onEmpty={() => setPending({ kind: 'side', side: s })}
                    />
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {pending && (
        <ConfirmWindow
          title={t(TITLES[pending.kind])}
          message={stakes(pending, t)}
          confirmLabel={pending.kind === 'entry' ? t('confirm.delete') : t(TITLES[pending.kind])}
          confirmLabelKey={pending.kind === 'entry' ? 'confirm.delete' : TITLES[pending.kind]}
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
            glyph={<IconPrune />}
            title={t('trash.pruneHint')}
            disabled={busy || totals.entries === 0}
            onClick={() => setPending({ kind: 'prune', sides: full })}
          />
        </span>
        <PageAction
          primary
          label={t('trash.emptyAll')}
          labelKey="trash.emptyAll"
          glyph={<IconEmpty />}
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
  entries,
  busy,
  sort,
  onSort,
  tip,
  jobHead,
  onRestore,
  onDelete,
  onEmpty,
}: {
  side: TrashSide
  /** The side's entries the search leaves, in the order the heads ask for. */
  entries: TrashEntry[]
  busy: boolean
  sort?: ListSort
  onSort: (next: ListSort) => void
  /** Whether this list's head shows the page's first-visit hint. */
  tip: boolean
  /** The head that filters the page by job, which only the first list on the page carries. */
  jobHead?: Head
  onRestore: (entry: TrashEntry) => void
  onDelete: (entry: TrashEntry) => void
  onEmpty: () => void
}) {
  const { t, lang } = useT()
  const heads: Head[] = [
    { id: 'path', label: t('list.head.path'), className: 'min-w-0 flex-1', sorts: true },
    ...(jobHead ? [jobHead] : []),
    { id: 'size', label: t('list.head.size'), className: 'w-20 shrink-0 max-sm:hidden', sorts: true },
    { id: 'age', label: t('list.head.age'), className: 'w-28 shrink-0', end: true, sorts: true },
  ]
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
        <p className="text-subline text-statusFail">{t('trash.unread', { error: failureLine(side.error, side.failure, t, lang) })}</p>
      ) : (
        <>
          <ListHead heads={heads} sort={sort} onSort={onSort} page={tip ? 'trash' : undefined} search />
          <Rows className="-mx-2 flex flex-col">
            {entries.map((e) => (
              <li
                key={e.remote}
                className="glim-row flex min-h-10 items-center gap-3 rounded-control px-2 text-subline hover:bg-carbon-hover"
              >
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
                <span className="w-20 shrink-0 whitespace-nowrap text-carbon-textMuted max-sm:hidden">
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
        </>
      )}

      {side.total > side.entries.length && (
        <p className="text-subline text-carbon-textMuted">{t('trash.more', { total: side.total, shown: side.entries.length })}</p>
      )}
    </section>
  )
}
