import { useMemo, useState, type MouseEvent } from 'react'

import { Empty, Rows, Stack } from '../components/Shell'
import { Dialog } from '../components/Dialog'
import { FilterButton, FilterChoice, ListBar, SearchFold, SortButton } from '../components/ListBar'
import { ContextMenu, type MenuItem } from '../components/Menu'
import { SelectionMark } from '../components/SelectionMark'
import { Since } from '../components/Since'
import { Card } from '../lib/glimstone/Card'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { ApiError, api, type ConflictListing, type OpenConflict, type Resolution } from '../lib/api'
import { conflictKey, decisionsByJob, newerSide } from '../lib/conflicts'
import { useT, type TranslationKey } from '../lib/i18n'
import { useRowSelection } from '../lib/rowSelection'
import { useToast } from '../lib/toast'
import { Version } from './Preview'

/** The three answers in the order they stand everywhere: holding back first, then the two that pick. */
const CHOICES: { keep: Resolution; key: TranslationKey }[] = [
  { keep: 'both', key: 'conflict.keepBoth' },
  { keep: 'left', key: 'conflict.keepLeft' },
  { keep: 'right', key: 'conflict.keepRight' },
]

type Order = 'oldest' | 'newest' | 'job'

const ORDERS: { value: Order; label: TranslationKey }[] = [
  { value: 'oldest', label: 'list.sort.oldestFirst' },
  { value: 'newest', label: 'list.sort.newestFirst' },
  { value: 'job', label: 'conflicts.sort.job' },
]

/**
 * Every conflict a run kept both versions of that nobody has decided, across
 * all jobs. Rows are picked as in a file manager, a plain click opens one
 * conflict with its two versions, and a choice runs the job's decision at
 * once; the version that loses goes to the trash, so a wrong click is undone
 * from there.
 */
export function Conflicts({
  listing,
  job,
  onJob,
  onChanged,
}: {
  /** Null until the first answer arrives. */
  listing: ConflictListing | null
  /** The job the address narrows the page to, empty for every job. */
  job: string
  /** Narrows the page to another job, by changing the address. */
  onJob: (job: string) => void
  /** Asks for a job's conflicts and trash again after something was decided. */
  onChanged: (job: string) => void
}) {
  const { t } = useT()
  const push = useToast()
  const [order, setOrder] = useState<Order>('oldest')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [opened, setOpened] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; rows: OpenConflict[] } | null>(null)

  const all = listing?.conflicts ?? []
  const jobs = useMemo(() => [...new Set([...all.map((c) => c.job), ...(job ? [job] : [])])].sort((a, b) => a.localeCompare(b)), [all, job])
  const needle = query.trim().toLocaleLowerCase()
  const shown = useMemo(() => {
    const kept = all
      .filter((c) => !job || c.job === job)
      .filter((c) => !needle || c.plain.toLocaleLowerCase().includes(needle))
    if (order === 'newest') return [...kept].reverse()
    if (order === 'job') return [...kept].sort((a, b) => a.job.localeCompare(b.job) || a.plain.localeCompare(b.plain))
    return kept
  }, [all, job, needle, order])
  const pick = useRowSelection(shown.map(conflictKey))
  const chosen = shown.filter((c) => pick.picked.has(conflictKey(c)))
  const open = opened ? all.find((c) => conflictKey(c) === opened) : undefined

  async function decide(rows: OpenConflict[], keep: Resolution) {
    setBusy(new Set(rows.map(conflictKey)))
    let decided = 0
    for (const [name, decisions] of decisionsByJob(rows, keep)) {
      try {
        const { run } = await api.decide(name, decisions)
        decided += decisions.length - run.Skipped
        if (run.Skipped > 0) push(t('conflicts.skipped', { count: run.Skipped }), 'fail')
      } catch (e) {
        push(e instanceof ApiError && e.status === 409 ? t('conflicts.running', { job: name }) : (e as Error).message, 'fail')
      }
      onChanged(name)
    }
    if (decided > 0) push(t('conflicts.decided', { count: decided }))
    setBusy(new Set())
  }

  const answers = (rows: OpenConflict[]): MenuItem[] =>
    CHOICES.map(({ keep, key }) => ({ label: t(key), labelKey: key, disabled: busy.size > 0, onSelect: () => void decide(rows, keep) }))

  function onRowClick(e: MouseEvent, c: OpenConflict) {
    if (!pick.click(e, conflictKey(c))) setOpened(conflictKey(c))
  }

  return (
    <Stack>
      <div className="flex flex-col gap-6">
        <ListBar newId="list-bar">
          <FilterButton active={job !== ''}>
            <FilterChoice
              label={t('history.filterJob')}
              value={job}
              onChange={onJob}
              options={[{ value: '', label: t('history.allJobs') }, ...jobs.map((n) => ({ value: n, label: n }))]}
            />
          </FilterButton>
          <SortButton value={order} onChange={setOrder} options={ORDERS.map((o) => ({ value: o.value, label: t(o.label) }))} />
          <SearchFold value={query} onChange={setQuery} placeholder={t('history.pathHint')} />
        </ListBar>

        <Card title={job || t('history.allJobs')} hueIndex={0} hint={t('conflicts.hint')}>
          {shown.length > 0 && (
            // The answers for everything picked; the same three stand on each
            // row for one conflict at a time.
            <div className="glim-selecting flex min-h-9 flex-wrap items-center gap-3 ps-2">
              <SelectionMark checked={pick.allPicked} onPick={() => pick.setAll(!pick.allPicked)} label={t('conflicts.selectAll')} />
              <span className="glim-num text-meta text-carbon-textMuted">
                {pick.selecting ? t('conflicts.chosen', { count: chosen.length }) : t('conflicts.count', { count: shown.length })}
              </span>
              {pick.selecting && (
                <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
                  {CHOICES.map(({ keep, key }) => (
                    <Button
                      key={keep}
                      label={t(key)}
                      labelKey={key}
                      disabled={busy.size > 0}
                      onClick={() => void decide(chosen, keep)}
                    />
                  ))}
                  <InfoBubble tip={t('conflicts.chooseHint')} />
                </div>
              )}
            </div>
          )}

          {listing === null ? (
            <Empty>{t('history.working')}</Empty>
          ) : shown.length === 0 ? (
            <Empty>{job || query ? t('conflicts.noneInJob') : t('conflicts.none')}</Empty>
          ) : (
            <Rows className={`-mx-2 flex flex-col ${pick.selecting ? 'glim-selecting' : ''}`}>
              {shown.map((c) => {
                const key = conflictKey(c)
                const picked = pick.picked.has(key)
                return (
                  <Row
                    key={key}
                    conflict={c}
                    withJob={!job}
                    picked={picked}
                    busy={busy.has(key)}
                    idle={busy.size === 0}
                    onClick={(e) => onRowClick(e, c)}
                    onPick={(range) => pick.mark(key, range)}
                    onMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, rows: picked ? chosen : [c] })
                    }}
                    onDecide={(keep) => void decide([c], keep)}
                  />
                )
              })}
            </Rows>
          )}
        </Card>
      </div>

      {listing?.unread.map((u) => (
        <Card key={u.job} title={u.job} hueIndex={1}>
          <p className="text-subline text-statusFail">{t('conflicts.unread', { job: u.job, error: u.error })}</p>
        </Card>
      ))}

      {menu && (
        <ContextMenu label={t('nav.conflicts')} items={answers(menu.rows)} at={menu} onClose={() => setMenu(null)} />
      )}

      {open && (
        <Dialog title={open.plain} onClose={() => setOpened(null)} wide>
          <div className="flex flex-col gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Version side={t('side.left')} version={open.left} newer={newerSide(open) === 'left'} />
              <Version side={t('side.right')} version={open.right} newer={newerSide(open) === 'right'} />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {CHOICES.map(({ keep, key }) => (
                <Button
                  key={keep}
                  label={t(key)}
                  labelKey={key}
                  busy={busy.has(conflictKey(open))}
                  disabled={busy.size > 0}
                  onClick={() => {
                    void decide([open], keep)
                    setOpened(null)
                  }}
                />
              ))}
            </div>
          </div>
        </Dialog>
      )}
    </Stack>
  )
}

function Row({
  conflict: c,
  withJob,
  picked,
  busy,
  idle,
  onClick,
  onPick,
  onMenu,
  onDecide,
}: {
  conflict: OpenConflict
  /** Whether to name the job, which a list narrowed to one job does not need. */
  withJob: boolean
  picked: boolean
  busy: boolean
  /** False while any decision is under way, so two cannot race for one job. */
  idle: boolean
  onClick: (e: MouseEvent) => void
  onPick: (range: boolean) => void
  onMenu: (e: MouseEvent) => void
  onDecide: (keep: Resolution) => void
}) {
  const { t } = useT()
  const newer = newerSide(c)
  return (
    <li
      data-picked={picked || undefined}
      onClick={onClick}
      onContextMenu={onMenu}
      // Shift+click would otherwise mark the text between the two rows.
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault()
      }}
      className="glim-row flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 hover:bg-carbon-hover"
    >
      <SelectionMark checked={picked} onPick={onPick} label={t('conflicts.select')} />
      <span className="min-w-0 flex-1 truncate font-mono text-subline text-carbon-text" title={c.plain}>
        {c.plain}
      </span>
      {withJob && <Badge tone="neutral">{c.job}</Badge>}
      {newer && <Badge tone="neutral">{t(newer === 'left' ? 'conflicts.newerLeft' : 'conflicts.newerRight')}</Badge>}
      <span className="glim-row-actions flex shrink-0 items-center gap-1.5 max-md:hidden" onClick={(e) => e.stopPropagation()}>
        {CHOICES.map(({ keep, key }) => (
          <Button key={keep} label={t(key)} labelKey={key} busy={busy} disabled={!idle} onClick={() => onDecide(keep)} />
        ))}
      </span>
      <span className="w-28 shrink-0 text-end text-subline text-carbon-textMuted max-sm:hidden">
        <Since when={c.at} />
      </span>
    </li>
  )
}
