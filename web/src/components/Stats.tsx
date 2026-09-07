import { useEffect, useState } from 'react'

import { api, type HistoryStats } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * What the runs have added up to, over the last month.
 *
 * The list below this answers "what happened on Tuesday". It cannot answer "is
 * this thing actually doing anything", which is the question somebody has after
 * leaving a sync tool alone for three weeks, and it is the question a row of
 * numbers answers badly: fifty rows of "12 copied" is not the same as seeing
 * that the last four days are empty.
 *
 * A day with no runs is drawn as an empty column rather than left out. A chart
 * that closes its gaps turns "nothing happened" into "nothing to show", and
 * those are opposite meanings: one is a machine at rest and the other is a
 * machine that stopped.
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
        // A missing summary is not worth an error banner over a page whose
        // main content is the list underneath. It simply does not draw.
        if (live) setStats(null)
      })
    return () => {
      live = false
    }
  }, [job])

  if (!stats || stats.rows.length === 0) return null

  // Scaled against the busiest day rather than against a fixed number, because
  // one person's busy day is twelve files and another's is nine thousand, and a
  // fixed scale makes one of those two charts a flat line.
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

      {/* Drawn with plain boxes rather than a charting library. Thirty columns
          that are one number tall each is not a chart problem, and a library
          would be three hundred kilobytes to draw thirty rectangles. */}
      {/* ONE colour across the chart, deliberately, and against the house habit
          of giving every element in a list its own palette position. That rule
          is about destinations and controls: thirty bars in thirty colours is a
          barcode, and the red that marks a day with a failure would be one hue
          among thirty rather than the one thing that stands out. */}
      <div className="flex items-end gap-[2px]" style={{ height: HEIGHT }} aria-hidden>
        {stats.rows.map((r) => (
          <div
            key={`${r.day}-${r.job}`}
            data-tip={`${r.day}: ${t('stats.runs', { count: r.runs })}`}
            className="min-w-[3px] flex-1"
            style={{
              // A day with runs always draws something, even when it is a
              // single run against a busiest day of two hundred: a column
              // rounded down to nothing says the same as no column at all.
              height: r.runs === 0 ? 2 : Math.max(3, Math.round((r.runs / busiest) * HEIGHT)),
              borderRadius: 'var(--radius-control)',
              // The raw tokens, not the Tailwind aliases: this is an inline
              // style, and `bg-statusFailSolid` is a class name rather than a
              // value. Getting that wrong renders a transparent bar, which
              // reads as a quiet day rather than as a mistake.
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
