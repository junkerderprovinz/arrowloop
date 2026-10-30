import { Badge } from '../lib/glimstone/Badge'
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
 * `withJob` adds the job column, which only makes sense across jobs.
 */
export function TouchRow({ touch: e, withJob }: { touch: Touch; withJob?: boolean }) {
  const { t, lang } = useT()
  const { jobs, drives } = usePlaces()
  // The path and the arrow beside it say where, so the badge only says what.
  const label = entryAction(t, e, jobs.find((j) => j.name === e.Job), drives)
  const note = entryNote(t, e)
  // shrink-0: in a list of fixed height, min-h-9 would otherwise be all the
  // room a row keeps, and a path that wraps would run over the next one.
  return (
    <li className="flex min-h-9 shrink-0 items-center gap-x-3 gap-y-1 py-1 text-subline max-sm:flex-wrap">
      {/* Wide enough for a conflict's phrase in the longer languages; a longer
          one wraps inside its badge rather than being cut. */}
      <span className="flex w-64 shrink-0 max-md:w-48 max-sm:w-auto max-sm:max-w-full">
        <Badge tone={touchTone(e)} wrap>
          {label}
        </Badge>
      </span>
      <span className="glim-num w-40 shrink-0 whitespace-nowrap text-carbon-textMuted max-sm:hidden">
        {dayTime(e.When, lang, (p) => t('list.when', p))}
      </span>
      {withJob && (
        <span className="w-32 shrink-0 font-medium [overflow-wrap:anywhere] max-md:hidden">{e.Job}</span>
      )}
      <span className="w-14 shrink-0 text-end tabular-nums text-carbon-textMuted max-sm:hidden">
        {e.Size > 0 ? bytes(e.Size) : ''}
      </span>
      {/* The side written to, drawn as an arrow; the word stays in the title
          and the accessible name. */}
      <span
        className="flex w-6 shrink-0 justify-center text-carbon-textMuted"
        title={e.Side ? translateSide(t, e.Side as 'left' | 'right') : undefined}
      >
        {e.Side === 'right' ? <IconToRight /> : e.Side === 'left' ? <IconToLeft /> : null}
        {e.Side && <span className="sr-only">{translateSide(t, e.Side as 'left' | 'right')}</span>}
      </span>
      {/* A long path wraps rather than losing its end, which is the file's name. */}
      <span
        className="min-w-0 flex-1 font-mono text-carbon-text [overflow-wrap:anywhere] max-sm:basis-full"
        title={note || undefined}
      >
        {e.Path}
      </span>
    </li>
  )
}
