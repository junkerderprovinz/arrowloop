import { useEffect, useState } from 'react'

import { Lines, Text } from './Field'
import { IconAdd, IconDelete } from './glyphs'
import { IconAction } from './IconAction'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * Reusable exclude lists, written once in the settings and named by jobs.
 *
 * The loader refuses a job that names an undefined set, because a filter that
 * silently matches nothing syncs exactly what somebody asked to leave alone.
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
              labelKey="sets.remove"
              onClick={() => {
                // The jobs that use it are left alone: saving then fails with
                // the job's name in the message, which beats silently editing
                // somebody's jobs.
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
                // An empty pattern matches nothing in some engines and
                // everything in others.
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
          labelKey="sets.add"
          onClick={() => {
            const name = adding.trim()
            // A taken name would overwrite the existing set.
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
 * The picker, for a job. Chips, because a job can take several sets; they
 * share the row, so the strip ends where the card does.
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
            style={{ borderRadius: 'var(--radius-pill)' }}
            className={`inline-flex h-[var(--badge-md)] grow items-center justify-center px-3 font-mono text-xs transition-colors ${
              on
                ? 'bg-accent text-accentContrast'
                : 'bg-carbon-surface2 text-carbon-textSub hover:bg-carbon-surface3 hover:text-carbon-text'
            }`}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}
