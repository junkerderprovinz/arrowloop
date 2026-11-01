// The Anomalies page: tiles that count the findings by severity and pick
// which the list shows, every finding as a card of its own with its figures
// and its answers, and below them how far each job's runs are learned. The
// layout is BombVault's, so a finding reads the same in both apps.
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { FindingCard } from '../components/FindingCard'
import { IconAnomalies } from '../components/glyphs'
import { JobChip } from '../components/JobChip'
import { LearningRings } from '../components/LearningRings'
import { ListHead, ListSearch, Narrowed, type Head, type ListSort } from '../components/ListHead'
import { openClosedFindings } from './History'
import { IconHistory } from '../components/glyphs'
import { Button } from '../lib/glimstone/Button'
import { Empty, Stack } from '../components/Shell'
import { Tiles } from '../components/Tiles'
import { Card } from '../lib/glimstone/Card'
import { SEVERITIES, countBySeverity, findingOrder, type FindingListing, type JobLearning, type Severity } from '../lib/anomalies'
import { api } from '../lib/api'
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
  const [sort, setSort] = useState<ListSort>({ by: 'severity', dir: 'asc' })
  const [query, setQuery] = useState('')
  const area = useRef<HTMLDivElement>(null)
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
  const pool = open.filter((f) => !job || f.job === job)
  const searching = query.trim() !== ''
  const shown = pool
    .filter((f) => tile === 'all' || f.severity === tile)
    .filter((f) => !searching || matchesQuery(query, [f.job, f.detail ?? '', ...(f.paths ?? [])]))
    .sort(findingOrder(sort))

  // A link names one finding, which is brought into view once it is listed.
  const focused = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!focusFinding || focused.current === focusFinding) return
    const el = document.getElementById(`finding-${focusFinding}`)
    if (!el) return
    focused.current = focusFinding
    el.scrollIntoView({ block: 'center' })
  }, [focusFinding, shown])

  const narrowing = searching ? [t('list.searched', { q: query.trim() })] : []
  const heads: Head[] = [
    { id: 'severity', label: t('list.head.severity'), sorts: true },
    { id: 'job', label: t('history.filterJob'), sorts: true },
    { id: 'since', label: t('anomaly.sinceLabel'), sorts: true },
  ]
  return (
    <Stack>
      <JobChip job={job} onClear={() => onJob('')} />

      <SeverityTiles counts={countBySeverity(open.filter((f) => !job || f.job === job))} chosen={tile} onChoose={setTile}>
        <Narrowed what={narrowing} onClear={() => setQuery('')} />
      </SeverityTiles>

      <div data-new="finding-cards">
        <Card title={tile === 'all' ? t('anomalies.all') : t(TILE_LABEL[tile])} hueIndex={0}>
          <div ref={area} tabIndex={-1} className="relative flex flex-col gap-2.5 outline-none">
            <ListSearch value={query} onChange={setQuery} placeholder={t('history.runSearch')} area={area} />
            <ListHead heads={heads} sort={sort} onSort={setSort} page="anomalies" search />
            {listing === null ? (
              <Empty>{t('history.working')}</Empty>
            ) : shown.length === 0 ? (
              <Empty>{pool.length === 0 ? t('anomaly.none') : t('anomaly.noneShown')}</Empty>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {shown.map((f, i) => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    lead={i === 0}
                    onChanged={onChanged}
                    onAllowed={(name) => allowed.current.set(name, refused[name] ?? 0)}
                  />
                ))}
              </ul>
            )}
          </div>
          {/* What was closed lives in History, which logs what happened. */}
          {closed.some((f) => !job || f.job === job) && (
            <div className="flex justify-end">
              <Button
                label={t('anomalies.closedInHistory')}
                labelKey="anomalies.closedInHistory"
                glyph={<IconHistory />}
                tone="subtle"
                onClick={openClosedFindings}
              />
            </div>
          )}
        </Card>
      </div>


      {tile === 'all' && learning && learning.length > 0 && (
        <div data-new="learning">
          <Card title={t('anomaly.learn.title')} hint={t('anomaly.learn.hint')} hueIndex={1}>
            <LearningRings learning={learning.filter((l) => !job || l.job === job)} onOpen={openJob} />
          </Card>
        </div>
      )}
    </Stack>
  )
}

/**
 * The tiles count the open findings by severity and pick what the list shows:
 * everything, or one severity.
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
  children?: ReactNode
}) {
  const { t, lang } = useT()
  const format = new Intl.NumberFormat(lang)
  const total = counts.critical + counts.warning + counts.info
  const tile = (id: Tile, label: string, count: number) => ({
    id,
    label,
    count,
    detail: t('anomaly.tile.open', { count: format.format(count) }),
  })
  return (
    <Tiles<Tile>
      label={t('anomaly.filter')}
      glyph={<IconAnomalies />}
      tiles={[tile('all', t('anomalies.all'), total), ...SEVERITIES.map((s) => tile(s, t(TILE_LABEL[s]), counts[s]))]}
      chosen={chosen}
      onChoose={onChoose}
    >
      {children}
    </Tiles>
  )
}
