// The Anomalies page: tiles that count the findings by severity and pick
// which the list shows, every finding as a card of its own with its figures
// and its answers, and below them how far each job's runs are learned. The
// layout is BombVault's, so a finding reads the same in both apps.
import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { FindingCard } from '../components/FindingCard'
import { IconAnomalies } from '../components/glyphs'
import { JobChip } from '../components/JobChip'
import { LearningRings } from '../components/LearningRings'
import { Selector } from '../components/Selector'
import { Empty, Stack } from '../components/Shell'
import { Card } from '../lib/glimstone/Card'
import { SEVERITIES, countBySeverity, type FindingListing, type JobLearning, type Severity } from '../lib/anomalies'
import { api } from '../lib/api'
import { hueVars } from '../lib/appearance'
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
  const [closedView, setClosedView] = useState(false)
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
  const rank = (s: Severity) => SEVERITIES.indexOf(s)
  const shown = pool
    .filter((f) => tile === 'all' || f.severity === tile)
    .sort((a, b) => (closedView ? 0 : rank(a.severity) - rank(b.severity)) || a.job.localeCompare(b.job))

  // A link names one finding, which is brought into view once it is listed.
  const focused = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!focusFinding || focused.current === focusFinding) return
    const el = document.getElementById(`finding-${focusFinding}`)
    if (!el) return
    focused.current = focusFinding
    el.scrollIntoView({ block: 'center' })
  }, [focusFinding, shown])

  return (
    <Stack>
      <JobChip job={job} onClear={() => onJob('')} />

      <SeverityTiles counts={countBySeverity(open.filter((f) => !job || f.job === job))} chosen={tile} onChoose={setTile} />

      <div className="flex md:justify-end">
        <div className="w-full sm:w-auto sm:min-w-64">
          <Selector<'open' | 'closed'>
            scale="small"
            label={t('anomalies.which')}
            value={closedView ? 'closed' : 'open'}
            onChange={(next) => setClosedView(next === 'closed')}
            options={[
              { value: 'open', label: t('anomalies.openTab') },
              { value: 'closed', label: t('anomaly.closed') },
            ]}
          />
        </div>
      </div>

      <div data-new="finding-cards">
        <Card title={closedView ? t('anomaly.closed') : tile === 'all' ? t('anomalies.all') : t(TILE_LABEL[tile])} hueIndex={0}>
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
        </Card>
      </div>

      {!closedView && tile === 'all' && learning && learning.length > 0 && (
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
 * everything, or one severity. The rest of the page stays.
 */
function SeverityTiles({
  counts,
  chosen,
  onChoose,
}: {
  counts: Record<Severity, number>
  chosen: Tile
  onChoose: (tile: Tile) => void
}) {
  const { t, lang } = useT()
  const format = new Intl.NumberFormat(lang)
  const total = counts.critical + counts.warning + counts.info
  const tiles: { tile: Tile; label: string; count: number }[] = [
    { tile: 'all', label: t('anomalies.all'), count: total },
    ...SEVERITIES.map((s) => ({ tile: s as Tile, label: t(TILE_LABEL[s]), count: counts[s] })),
  ]
  return (
    <div role="group" aria-label={t('anomaly.filter')} className="rounded-card bg-carbon-surface p-3 max-[600px]:p-2">
      <div className="flex flex-wrap justify-center gap-2 max-[860px]:grid max-[860px]:grid-cols-2 max-[600px]:flex max-[600px]:flex-nowrap max-[600px]:justify-start max-[600px]:overflow-x-auto">
        {tiles.map(({ tile, label, count }, i) => {
          const on = tile === chosen
          return (
            <button
              key={tile}
              type="button"
              aria-pressed={on}
              onClick={() => onChoose(tile)}
              style={hueVars(i) as CSSProperties}
              className={`glim-hue flex min-w-40 flex-1 items-center gap-2.5 rounded-card px-3 py-2 text-start transition-colors max-[860px]:min-w-0 max-[600px]:flex-none max-[600px]:rounded-[var(--radius-pill)] max-[600px]:py-1.5 ${
                on ? 'glim-active bg-accent text-accentContrast' : 'bg-carbon-surface2 text-carbon-text hover:bg-carbon-surface3'
              }`}
            >
              <span className="flex [&_svg]:h-5 [&_svg]:w-5 max-[600px]:hidden" aria-hidden>
                <IconAnomalies />
              </span>
              <span className="min-w-0 flex-1 truncate text-body font-semibold">{label}</span>
              <span className="glim-num text-body font-semibold">{format.format(count)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
