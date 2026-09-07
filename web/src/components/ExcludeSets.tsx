import { useEffect, useState } from 'react'

import { Lines, Text } from './Field'
import { IconAdd, IconDelete } from './glyphs'
import { IconAction } from './IconAction'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * Reusable exclude lists, edited in one place and asked for by name.
 *
 * "The usual junk" was being pasted into every job and then drifting apart, so
 * two jobs that were meant to ignore the same things quietly stopped doing so.
 * A set is written once here; a job names it.
 *
 * A name nobody defined is refused when the file loads, and that refusal is the
 * point rather than strictness. A filter that silently matches nothing does not
 * break anything: it just quietly syncs the thing somebody asked to leave alone,
 * and nobody finds out until they go looking for why their private folder is on
 * the other machine.
 */

export type Sets = Record<string, string[]>

/** The editor, for the settings page. */
export function ExcludeSetEditor({
  sets,
  onChange,
}: {
  sets: Sets
  onChange: (next: Sets) => void
}) {
  const { t } = useT()
  const [adding, setAdding] = useState('')

  const names = Object.keys(sets).sort()

  return (
    <div className="flex flex-col gap-4">
      {names.length === 0 && <p className="text-xs text-carbon-textMuted">{t('sets.none')}</p>}

      {names.map((name) => (
        <div key={name} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{name}</span>
            <IconAction
              title={t('sets.remove')}
              onClick={() => {
                // Removing a set does NOT go looking for the jobs that use it.
                // The loader refuses a job asking for a set that is gone, which
                // means the mistake surfaces at the moment the file is saved,
                // with the job's own name in the message. Silently editing
                // somebody's jobs from here would be the worse answer.
                const next = { ...sets }
                delete next[name]
                onChange(next)
              }}
            >
              <IconDelete />
            </IconAction>
          </div>
          <Lines
            value={sets[name].join('\n')}
            rows={4}
            onChange={(text) =>
              onChange({
                ...sets,
                // Blank lines dropped: a trailing newline is what a textarea
                // gives you for free, and an empty pattern matches nothing in
                // some engines and everything in others.
                [name]: text.split('\n').map((l) => l.trim()).filter(Boolean),
              })
            }
          />
        </div>
      ))}

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Text value={adding} onChange={setAdding} placeholder={t('sets.newName')} mono />
        </div>
        <IconAction
          title={t('sets.add')}
          onClick={() => {
            const name = adding.trim()
            // An empty name, or one that is already taken. Overwriting a set
            // because two of them share a name is how a list somebody spent an
            // evening on disappears.
            if (!name || sets[name]) return
            onChange({ ...sets, [name]: [] })
            setAdding('')
          }}
        >
          <IconAdd />
        </IconAction>
      </div>
    </div>
  )
}

/**
 * The picker, for a job.
 *
 * Chips rather than a dropdown, because a job takes SEVERAL sets and a dropdown
 * that closes after one choice makes picking three of them three interactions
 * plus three re-openings.
 */
export function ExcludeSetPicker({
  chosen,
  onChange,
}: {
  chosen: string[]
  onChange: (next: string[]) => void
}) {
  const { t } = useT()
  const [available, setAvailable] = useState<string[] | null>(null)

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        const sets = (s.excludeSets as Sets | undefined) ?? {}
        setAvailable(Object.keys(sets).sort())
      })
      .catch(() => setAvailable([]))
  }, [])

  if (available === null) return null
  if (available.length === 0) {
    return <p className="text-xs text-carbon-textMuted">{t('sets.noneYet')}</p>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {available.map((name) => {
        const on = chosen.includes(name)
        return (
          <button
            key={name}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(on ? chosen.filter((c) => c !== name) : [...chosen, name])
            }
            style={{ borderRadius: 'var(--radius-control)' }}
            className={`inline-flex h-[var(--badge-md)] items-center px-3 font-mono text-xs transition-colors ${
              on
                ? 'bg-accent text-accentContrast'
                : 'bg-carbon-surface2 text-carbon-textSub hover:bg-carbon-hover hover:text-carbon-text'
            }`}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}
