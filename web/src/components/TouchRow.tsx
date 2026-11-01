import { Badge } from '../lib/glimstone/Badge'
import type { Columns } from '../lib/columns'
import { IconToLeft, IconToRight } from './glyphs'
import type { Touch } from '../lib/api'
import { bytes } from '../lib/bytes'
import { dayTime } from '../lib/dayTime'
import { entryAction, entryNote, unreadFolder } from '../lib/entryLabel'
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
 * could not be read is a warning: nothing in it was touched.
 */
function touchTone(e: Touch): 'warn' | 'fail' | 'neutral' {
  if (unreadFolder(e)) return 'warn'
  if (e.Kind === 'skip' || e.Kind === 'error') return 'fail'
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
  // The path and the arrow beside it say where, so the badge only says what.
  const label = entryAction(t, e, jobs.find((j) => j.name === e.Job), drives)
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
      <span style={columns?.cell('what')} className={`flex w-64 min-w-0 shrink-0 max-md:w-48 max-sm:w-auto max-sm:max-w-full${grid}`}>
        <Badge tone={touchTone(e)} wrap={!columns} className={columns ? 'min-w-0 max-w-full' : ''}>
          {columns ? <span className="truncate">{label}</span> : label}
        </Badge>
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
      {/* The side written to, drawn as an arrow; the word stays in the title
          and the accessible name. */}
      <span
        style={columns?.cell('side')}
        className="flex w-6 shrink-0 justify-center text-carbon-textMuted"
        title={e.Side ? translateSide(t, e.Side as 'left' | 'right') : undefined}
      >
        {e.Side === 'right' ? <IconToRight /> : e.Side === 'left' ? <IconToLeft /> : null}
        {e.Side && <span className="sr-only">{translateSide(t, e.Side as 'left' | 'right')}</span>}
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
