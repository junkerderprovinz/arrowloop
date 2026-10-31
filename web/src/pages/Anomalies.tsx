// The Anomalies page: tiles that count the findings by severity and pick
// which the list shows, every finding as a card of its own with its figures
// and its answers, and below them how far each job's runs are learned. The
// layout is BombVault's, so a finding reads the same in both apps.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { FindingCard } from '../components/FindingCard'
import { IconAnomalies } from '../components/glyphs'
import { JobChip } from '../components/JobChip'
import { LearningRings } from '../components/LearningRings'
import { FilterChoice, ListHead, ListSearch, Narrowed, useListMenu, type Head, type ListSort } from '../components/ListHead'
import type { MenuItem } from '../components/Menu'
import { Empty, Stack } from '../components/Shell'
import { Card } from '../lib/glimstone/Card'
import { SEVERITIES, countBySeverity, type Finding, type FindingListing, type JobLearning, type Severity } from '../lib/anomalies'
import { api } from '../lib/api'
import { hueVars } from '../lib/appearance'
import { matchesQuery } from '../lib/fold'
import { useT, type TranslationKey } from '../lib/i18n'
import { useOpenJob } from '../lib/openJob'
import { useToast } from '../lib/toast'

const TILE_LABEL: Record<Severity, TranslationKey> = {
  critical: 'anomaly.severity.critical',
  warning: 'anomaly.tile.warning',
  info: 'anomaly.tile.info',
}

type Tile = 'all' | Severity

/**
 * The order a head asks for. Severity runs from critical down and breaks its
 * ties by job; ascending time is the oldest first.
 */
function order(sort: ListSort): (a: Finding, b: Finding) => number {
  const sign = sort.dir === 'asc' ? 1 : -1
  const rank = (s: Severity) => SEVERITIES.indexOf(s)
  return (a, b) => {
    if (sort.by === 'job') return sign * a.job.localeCompare(b.job)
    if (sort.by === 'since') return sign * (Date.parse(a.since) - Date.parse(b.since))
    return sign * (rank(a.severity) - rank(b.severity)) || a.job.localeCompare(b.job)
  }
}

export function Anomalies({
  listing,
  job,
  finding: focusFinding,
  refused,
  onJob,
  onChanged,
}: {
  /** Null until the first answer arrives. */
  listing: FindingListing | null
  /** The job the address narrows the page to, empty for every job. */
  job: string
  /** The finding another screen sent somebody here for, which is brought into view. */
  finding?: string
  /** How often a brake has refused each job since the page loaded. */
  refused: Record<string, number>
  /** Narrows the page to another job, by changing the address. */
  onJob: (job: string) => void
  onChanged: () => void
}) {
  const { t } = useT()
  const push = useToast()
  const [tile, setTile] = useState<Tile>('all')
  const [closedView, setClosedView] = useState(false)
  const [sort, setSort] = useState<ListSort>({ by: 'severity', dir: 'asc' })
  const [query, setQuery] = useState('')
  const area = useRef<HTMLDivElement>(null)
  const openSearch = useRef<(() => void) | null>(null)
  const menu = useListMenu(t('nav.anomalies'))
  const [learning, setLearning] = useState<JobLearning[] | null>(null)
  const openJob = useOpenJob()
  // The jobs whose refused change was let run, with the refusals counted then.
  const allowed = useRef(new Map<string, number>())

  // The permission covers what was shown. A job the brake refuses again after
  // it was given has changed since, and says so.
  useEffect(() => {
    for (const [name, before] of allowed.current) {
      if ((refused[name] ?? 0) <= before) continue
      allowed.current.delete(name)
      push(t('anomaly.heldAgain', { job: name }), 'fail')
    }
  }, [refused, push, t])

  // Asked again whenever the findings change, which is when a run has finished.
  useEffect(() => {
    api
      .learning()
      .then(setLearning)
      .catch(() => setLearning(null))
  }, [listing])

  const open = listing?.open ?? []
  const closed = listing?.closed ?? []
  const pool = (closedView ? closed : open).filter((f) => !job || f.job === job)
  const searching = query.trim() !== ''
  const shown = pool
    .filter((f) => tile === 'all' || f.severity === tile)
    .filter((f) => !searching || matchesQuery(query, [f.job, f.detail ?? '', ...(f.paths ?? [])]))
    .sort(order(sort))

  // A link names one finding, which is brought into view once it is listed.
  const focused = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!focusFinding || focused.current === focusFinding) return
    const el = document.getElementById(`finding-${focusFinding}`)
    if (!el) return
    focused.current = focusFinding
    el.scrollIntoView({ block: 'center' })
  }, [focusFinding, shown])

  const narrowing = [...(closedView ? [t('anomaly.closed')] : []), ...(searching ? [`“${query.trim()}”`] : [])]
  function showAll() {
    setClosedView(false)
    setQuery('')
  }
  const heads: Head[] = [
    { id: 'severity', label: t('list.head.severity'), sorts: true },
    { id: 'job', label: t('history.filterJob'), sorts: true },
    { id: 'since', label: t('anomaly.sinceLabel'), sorts: true },
    {
      id: 'state',
      label: t('list.head.state'),
      className: 'ms-auto',
      filter: {
        active: closedView,
        panel: (
          <FilterChoice<'open' | 'closed'>
            label={t('anomalies.which')}
            value={closedView ? 'closed' : 'open'}
            onChange={(next) => setClosedView(next === 'closed')}
            options={[
              { value: 'open', label: t('anomalies.openTab') },
              { value: 'closed', label: t('anomaly.closed') },
            ]}
          />
        ),
      },
    },
  ]
  const listItems = (): MenuItem[] => [
    { label: t('list.search'), labelKey: 'list.search', onSelect: () => openSearch.current?.() },
    ...(narrowing.length > 0 ? [{ label: t('list.showAll'), labelKey: 'list.showAll' as const, onSelect: showAll }] : []),
  ]

  return (
    <Stack>
      <JobChip job={job} onClear={() => onJob('')} />

      <SeverityTiles counts={countBySeverity(open.filter((f) => !job || f.job === job))} chosen={tile} onChoose={setTile}>
        <Narrowed what={narrowing} onClear={showAll} />
      </SeverityTiles>

      <div data-new="finding-cards">
        <Card title={closedView ? t('anomaly.closed') : tile === 'all' ? t('anomalies.all') : t(TILE_LABEL[tile])} hueIndex={0}>
          <div ref={area} tabIndex={-1} className="relative flex flex-col gap-2.5 outline-none" {...menu.on(listItems)}>
            <ListSearch value={query} onChange={setQuery} placeholder={t('history.runSearch')} area={area} open={openSearch} />
            <ListHead heads={heads} sort={sort} onSort={setSort} page="anomalies" onSearch={() => openSearch.current?.()} menu />
            {listing === null ? (
              <Empty>{t('history.working')}</Empty>
            ) : shown.length === 0 ? (
              <Empty>{closedView ? t('anomaly.noneClosed') : pool.length === 0 ? t('anomaly.none') : t('anomaly.noneShown')}</Empty>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {shown.map((f, i) => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    lead={i === 0 && !closedView}
                    onChanged={onChanged}
                    onAllowed={(name) => allowed.current.set(name, refused[name] ?? 0)}
                  />
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>


      {!closedView && tile === 'all' && learning && learning.length > 0 && (
        <div data-new="learning">
          <Card title={t('anomaly.learn.title')} hint={t('anomaly.learn.hint')} hueIndex={1}>
            <LearningRings learning={learning.filter((l) => !job || l.job === job)} onOpen={openJob} />
          </Card>
        </div>
      )}
      {menu.element}
    </Stack>
  )
}

/**
 * The tiles count the open findings by severity and pick what the list shows:
 * everything, or one severity. The rest of the page stays.
 */
function SeverityTiles({
  counts,
  chosen,
  onChoose,
  children,
}: {
  counts: Record<Severity, number>
  chosen: Tile
  onChoose: (tile: Tile) => void
  /** What narrows the list, under the tiles. */
  children?: ReactNode
}) {
  const { t, lang } = useT()
  const format = new Intl.NumberFormat(lang)
  const total = counts.critical + counts.warning + counts.info
  const tiles: { tile: Tile; label: string; count: number }[] = [
    { tile: 'all', label: t('anomalies.all'), count: total },
    ...SEVERITIES.map((s) => ({ tile: s as Tile, label: t(TILE_LABEL[s]), count: counts[s] })),
  ]
  // BombVault's tile row and tiles, measure for measure: a glyph beside the
  // name over the count in words, as two rows of two below 860px and as one
  // row of chips with the number alone below 600px.
  return (
    <div role="group" aria-label={t('anomaly.filter')} className="rounded-card bg-carbon-surface p-3 max-[600px]:p-2">
      <div className="flex flex-wrap gap-2 max-[860px]:grid max-[860px]:grid-cols-2 max-[600px]:flex max-[600px]:flex-nowrap max-[600px]:gap-1.5 max-[600px]:overflow-x-auto max-[600px]:[scrollbar-width:none]">
        {tiles.map(({ tile, label, count }, i) => {
          const on = tile === chosen
          return (
            <button
              key={tile}
              type="button"
              aria-pressed={on}
              onClick={() => onChoose(tile)}
              style={hueVars(i) as CSSProperties}
              className={`glim-hue glim-hue-icon grid min-w-max flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-card px-3 py-2 text-start transition-colors max-[860px]:min-w-0 max-[600px]:flex max-[600px]:flex-none max-[600px]:gap-x-1.5 max-[600px]:rounded-[var(--radius-pill)] max-[600px]:py-1.5 ${
                on ? 'glim-active bg-accent text-accentContrast' : 'bg-carbon-surface2 text-carbon-text hover:bg-carbon-surface3'
              }`}
            >
              <span className="row-span-2 flex [&_svg]:h-[22px] [&_svg]:w-[22px] max-[600px]:[&_svg]:h-4 max-[600px]:[&_svg]:w-4" aria-hidden>
                <IconAnomalies />
              </span>
              <span className="truncate text-body leading-5 font-semibold">{label}</span>
              <span className="glim-num truncate text-meta leading-4 opacity-75 max-[600px]:hidden">
                {t('anomaly.tile.open', { count: format.format(count) })}
              </span>
              <span className="glim-num hidden text-meta font-semibold opacity-70 max-[600px]:inline">{format.format(count)}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-3 empty:hidden max-[600px]:mt-2">{children}</div>
    </div>
  )
}
