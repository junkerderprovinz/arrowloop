import { useEffect, useState } from 'react'

import { api, type HistoryStats } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * What the runs have added up to over the last month, as totals and a column
 * per day. A day with no runs keeps an empty column, so a machine that stopped
 * shows as a gap.
 */

/** How tall the tallest column is, in pixels. */
const HEIGHT = 44

export function Stats({ job }: { job?: string }) {
  const { t } = useT()
  const [stats, setStats] = useState<HistoryStats | null>(null)

  useEffect(() => {
    let live = true
    api
      .historyStats(job)
      .then((got) => {
        if (live) setStats(got)
      })
      .catch(() => {
        // The list underneath is the page's content; a missing summary just
        // does not draw.
        if (live) setStats(null)
      })
    return () => {
      live = false
    }
  }, [job])

  if (!stats || stats.rows.length === 0) return null

  // Scaled against the busiest day, since a fixed scale flattens either a quiet
  // setup or a busy one.
  const busiest = Math.max(1, ...stats.rows.map((r) => r.runs))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs">
        <span className="text-carbon-text">
          {t('stats.runs', { count: stats.totals.runs })}
        </span>
        <span className="text-carbon-textMuted">
          {t('stats.copied', { count: stats.totals.copied })}
        </span>
        <span className="text-carbon-textMuted">
          {t('stats.trashed', { count: stats.totals.trashed })}
        </span>
        {stats.totals.conflicts > 0 && (
          <span className="text-statusWarn">
            {t('stats.conflicts', { count: stats.totals.conflicts })}
          </span>
        )}
        {stats.totals.failed > 0 && (
          <span className="text-statusFail">
            {t('stats.failed', { count: stats.totals.failed })}
          </span>
        )}
      </div>

      {/* One colour for every bar rather than a palette position each, so the
          red of a day with a failure stands out. */}
      <div className="flex items-end gap-[2px]" style={{ height: HEIGHT }} aria-hidden>
        {stats.rows.map((r) => (
          <div
            key={`${r.day}-${r.job}`}
            data-tip={`${r.day}: ${t('stats.runs', { count: r.runs })}`}
            className="min-w-[3px] flex-1"
            style={{
              // A day with runs never rounds down to an empty column.
              height: r.runs === 0 ? 2 : Math.max(3, Math.round((r.runs / busiest) * HEIGHT)),
              borderRadius: 'var(--radius-control)',
              background: r.failed > 0 ? 'var(--status-fail-solid)' : 'var(--accent)',
              opacity: r.runs === 0 ? 0.25 : 1,
            }}
          />
        ))}
      </div>

      <p className="text-xs text-carbon-textMuted">
        {t('stats.window', { days: stats.days })}
      </p>
    </div>
  )
}
