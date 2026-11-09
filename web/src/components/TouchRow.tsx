import { Badge } from '../lib/glimstone/Badge'
import type { Columns } from '../lib/columns'
import { IconToLeft, IconToRight } from './glyphs'
import type { Touch } from '../lib/api'
import { bytes } from '../lib/bytes'
import { dayTime } from '../lib/dayTime'
import { entryAction, entryNote, placesOf, unreadFolder } from '../lib/entryLabel'
import { translateSide, useT } from '../lib/i18n'
import { usePlaces } from '../lib/places'

/**
 * A line's key, the same while its run goes and once it is stored, when the
 * run's id changes: a new key would remount every row once a second.
 */
export function touchKey(e: Touch): string {
  return `${e.Job}\n${e.When}\n${e.Seq}`
}

/**
 * Which lines are a problem, so they stand out in a long list. A folder that
 * could not be read is a warning: nothing in it was touched. A file left for
 * later is the next run's to try, so it stands out no more than a copy.
 */
function touchTone(e: Touch): 'warn' | 'fail' | 'neutral' {
  if (unreadFolder(e)) return 'warn'
  if (e.Kind === 'error') return 'fail'
  if (e.Kind === 'conflict') return 'warn'
  return 'neutral'
}

/**
 * One line of the file log, shared by a job's page and the History page.
 * `withJob` adds the job column, which only makes sense across jobs, and
 * `columns` lays the cells out in the order and widths of the list's head.
 */
export function TouchRow({ touch: e, withJob, columns }: { touch: Touch; withJob?: boolean; columns?: Columns }) {
  const { t, lang } = useT()
  const { jobs, drives } = usePlaces()
  // The sides around it and the arrow say where, so the badge only says what.
  const job = jobs.find((j) => j.name === e.Job)
  const label = entryAction(t, e, job, drives)
  const sides = job && (e.Side === 'left' || e.Side === 'right') ? placesOf(job, drives) : null
  const note = entryNote(t, e)
  // In the column grid every cell keeps to one line and its column, cut at the
  // end, so the rows read down their columns; the narrow flex row wraps instead.
  const grid = columns ? ' md:w-auto md:overflow-hidden md:whitespace-nowrap' : ''
  const jobColumn = columns ? columns.order.includes('job') : withJob
  // shrink-0: in a list of fixed height, min-h-9 would otherwise be all the
  // room a row keeps, and a path that wraps would run over the next one.
  return (
    <li
      className={`flex min-h-9 shrink-0 items-center gap-x-3 gap-y-1 py-1 text-subline max-sm:flex-wrap${
        columns ? ' md:grid md:[grid-template-columns:var(--list-cols)]' : ''
      }`}
    >
      {/* Wide enough for a conflict's phrase in the longer languages; a longer
          one wraps inside its badge rather than being cut, outside the grid. */}
      {/* Left side, what happened with an arrow to where it happened, right
          side: the way reads at a glance without the column heads. */}
      <span
        data-testid="touch-way"
        style={columns?.cell('what')}
        className={`flex w-96 min-w-0 shrink-0 items-center gap-2 max-md:w-72 max-sm:w-auto max-sm:max-w-full${grid}`}
      >
        {sides && <span className="min-w-0 shrink truncate text-carbon-textSub">{sides[0].name}</span>}
        <span className="flex min-w-0 shrink-0 items-center gap-1">
          <Badge tone={touchTone(e)} wrap={!columns} className={columns ? 'min-w-0 max-w-full' : ''}>
            {columns ? <span className="truncate">{label}</span> : label}
          </Badge>
          {sides && (
            <span className="flex shrink-0 text-carbon-textMuted" title={translateSide(t, e.Side)}>
              {e.Side === 'right' ? <IconToRight /> : <IconToLeft />}
              <span className="sr-only">{translateSide(t, e.Side)}</span>
            </span>
          )}
        </span>
        {sides && <span className="min-w-0 shrink truncate text-carbon-textSub">{sides[1].name}</span>}
      </span>
      <span style={columns?.cell('when')} className={`glim-num w-40 min-w-0 shrink-0 truncate whitespace-nowrap text-carbon-textMuted max-sm:hidden${grid}`}>
        {dayTime(e.When, lang, (p) => t('list.when', p))}
      </span>
      {jobColumn && (
        <span
          style={columns?.cell('job')}
          className={`w-32 min-w-0 shrink-0 font-medium [overflow-wrap:anywhere] max-md:hidden${grid}${columns ? ' md:truncate' : ''}`}
        >
          {e.Job}
        </span>
      )}
      <span style={columns?.cell('size')} className={`w-14 shrink-0 whitespace-nowrap tabular-nums text-carbon-textMuted max-sm:hidden${grid}`}>
        {e.Size > 0 ? bytes(e.Size) : ''}
      </span>
      {/* A long path wraps rather than losing its end outside the grid; in it
          the whole path is in the bubble. */}
      <span
        style={columns?.cell('path')}
        className={`min-w-0 flex-1 font-mono text-carbon-text [overflow-wrap:anywhere] max-sm:basis-full${columns ? ' md:truncate' : ''}`}
        title={[note, columns ? e.Path : ''].filter(Boolean).join('\n') || undefined}
      >
        {e.Path}
      </span>
    </li>
  )
}
