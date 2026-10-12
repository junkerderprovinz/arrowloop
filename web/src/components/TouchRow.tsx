import { Badge } from '../lib/glimstone/Badge'
import { IconToLeft, IconToRight } from './glyphs'
import { Since } from './Since'
import type { Touch } from '../lib/api'
import { bytes } from '../lib/bytes'
import { entryAction, entryNote } from '../lib/entryLabel'
import { translateSide, useT } from '../lib/i18n'
import { usePlaces } from '../lib/places'

/**
 * A line's key, the same while its run goes and once it is stored, when the
 * run's id changes: a new key would remount every row once a second.
 */
export function touchKey(e: Touch): string {
  return `${e.Job}\n${e.When}\n${e.Seq}`
}

/** Which kinds are a problem, so they stand out in a long list. */
function touchTone(kind: string): 'warn' | 'fail' | 'neutral' {
  if (kind === 'skip' || kind === 'error') return 'fail'
  if (kind === 'conflict') return 'warn'
  return 'neutral'
}

/**
 * One line of the file log, shared by a job's page and the History page.
 * `withJob` adds the job column, which only makes sense across jobs.
 */
export function TouchRow({ touch: e, withJob }: { touch: Touch; withJob?: boolean }) {
  const { t } = useT()
  const { jobs, drives } = usePlaces()
  // The path and the arrow beside it say where, so the badge only says what.
  const label = entryAction(t, e, jobs.find((j) => j.name === e.Job), drives)
  const note = entryNote(t, e)
  return (
    <li className="flex min-h-9 items-center gap-3 text-subline">
      {/* Wide enough for a conflict's phrase and a target's name; a longer one
          is cut, with the whole phrase in the title. */}
      <span className="w-44 shrink-0 truncate max-sm:w-28" title={label}>
        <Badge tone={touchTone(e.Kind)}>{label}</Badge>
      </span>
      <span className="w-28 shrink-0 whitespace-nowrap text-carbon-textMuted max-sm:hidden">
        <Since when={e.When} />
      </span>
      {withJob && (
        <span className="w-32 shrink-0 truncate font-medium max-md:hidden" title={e.Job}>
          {e.Job}
        </span>
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
      <span className="min-w-0 flex-1 truncate font-mono text-carbon-text" title={note ? `${e.Path}\n${note}` : e.Path}>
        {e.Path}
      </span>
    </li>
  )
}
