import { useMemo, useState } from 'react'

import { brandMark } from './brandMarks'
import { IconTargets } from './glyphs'
import { Field } from './Field'
import { useT } from '../lib/i18n'
import type { Backend, Provider } from '../lib/api'

/**
 * Pick what you are connecting to, by NAME rather than by protocol.
 *
 * The form this replaces opened on a backend dropdown, which asked somebody to
 * know that Nextcloud is "webdav" before they could set up their Nextcloud.
 * jdp: "wenn man auf den speicher anlegen klickt soll eine sehr schöne und
 * minimalistische Liste aller Clouds und Verbindungsmöglichkeiten kommen. inkl.
 * logos. wenn man dann einen auftrag auswählt sollen die dementsprechenden
 * Anmeldefelder kommen."
 *
 * Minimal on purpose: a name, a logo where one exists, and one line only where
 * the name does not say enough. No descriptions, no counts, no chevrons. The
 * search box is the only chrome, and it earns its place at fifty-odd entries.
 *
 * A tile with no logo is not a gap to be filled with something approximate. The
 * CC0 set has no mark for Microsoft's, Amazon's or Apple's own products, and
 * several providers share a parent company's mark rather than having their own.
 * A logo naming the WRONG service is worse than a generic glyph, so those show
 * the generic one.
 */
export function ProviderPicker({
  providers,
  unlisted,
  onPick,
}: {
  providers: Provider[]
  /** Compiled-in backends no provider entry covers, offered after the list. */
  unlisted: Backend[]
  onPick: (backend: string, preset: Record<string, string>) => void
}) {
  const { t } = useT()
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () => providers.filter((p) => !q || p.name.toLowerCase().includes(q) || p.backend.includes(q)),
    [providers, q],
  )
  const rest = useMemo(
    () => unlisted.filter((b) => !q || b.name.includes(q)),
    [unlisted, q],
  )

  return (
    <div className="flex flex-col gap-4 py-2">
      <Field label={t('targets.pickSearch')}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('targets.pickSearchPlaceholder')}
          className="h-[var(--btn-h)] w-full rounded-[var(--radius-control)] bg-carbon-surface2 px-3 text-dense text-carbon-text outline-none transition focus-visible:brightness-125"
        />
      </Field>

      {shown.length === 0 && rest.length === 0 && (
        <p className="text-xs text-carbon-textMuted">{t('targets.pickNothing')}</p>
      )}

      {/* A grid rather than a list: fifty names in one column is a scroll, and
          the same fifty in four columns is a page you read at a glance. The
          minimum column width is what a long product name needs without
          wrapping, so the grid loses columns on a narrow window rather than
          breaking names across lines. */}
      {shown.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p.backend, p.preset ?? {})}
                title={p.hint || undefined}
                className="flex w-full items-center gap-3 rounded-[var(--radius-control)] bg-carbon-surface2 px-3 py-2.5 text-start transition hover:bg-carbon-hover focus-visible:brightness-125"
              >
                {/* Fixed box whether or not there is a logo, so names line up
                    down the column instead of stepping in and out. */}
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[20px] text-carbon-textSub">
                  {brandMark(p.mark) ?? <IconTargets />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-dense text-carbon-text">{p.name}</span>
                  {p.hint && (
                    <span className="block truncate text-caption text-carbon-textMuted">{p.hint}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Everything rclone carries that nobody has written an entry for. Below
          a rule and in the same shape, so the list is complete without the
          named ones having to compete with fifty rclone type names. */}
      {rest.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-carbon-textMuted">
            {t('targets.pickMore', { count: rest.length })}
          </summary>
          <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
            {rest.map((b) => (
              <li key={b.name}>
                <button
                  type="button"
                  onClick={() => onPick(b.name, {})}
                  title={b.description}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-control)] bg-carbon-surface2 px-3 py-2.5 text-start transition hover:bg-carbon-hover focus-visible:brightness-125"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[20px] text-carbon-textSub">
                    <IconTargets />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-dense text-carbon-text">{b.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
