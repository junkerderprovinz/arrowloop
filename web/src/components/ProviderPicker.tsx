import type { CSSProperties } from 'react'
import { BRAND_TILES } from './brandGlyphs'
import { brandMark } from './brandMarks'
import { ReadmeButton } from '../lib/glimstone/ReadmeButton'
import { useT } from '../lib/i18n'
import { nameAndKind, providerHint, providerName } from '../lib/optionHint'
import type { Backend, Provider } from '../lib/api'

/**
 * Picks what a target connects to by product name rather than by protocol, as
 * README buttons: the mark at the start, the name beside it. A provider with
 * a brand lights up in the brand's colour from BRAND_TILES; a protocol wears
 * one of the app's own glyphs and lights up in the accent. Only the protocols
 * carry their hint in an info bubble, since a cloud's name already says what
 * it is. The order is alphabetical by the name shown, which for a few is
 * translated.
 */
export function ProviderPicker({
  providers,
  unlisted,
  onPick,
}: {
  providers: Provider[]
  /** Compiled-in backends no provider entry covers, offered after the list. */
  unlisted: Backend[]
  /**
   * The whole provider, so the form can name the target after the product and
   * explain its address shape. An unlisted backend arrives as its bare name.
   */
  onPick: (picked: Provider | string) => void
}) {
  const { t, lang } = useT()
  const sorted = [...providers].sort((a, b) =>
    providerName(a, t).localeCompare(providerName(b, t), lang, { sensitivity: 'base' }),
  )

  return (
    <div className="flex flex-col gap-4">
      {/* As many across as the window is wide, each at least the README
          button's width. The window scrolls the list. */}
      <ul className="glim-provider-pick">
        {sorted.map((p) => {
          const lit = p.mark ? BRAND_TILES[p.mark] : undefined
          const hint = providerHint(p.id, t)
          const bubble = p.group === 'protocol' ? hint : undefined
          return (
            <li
              key={p.id}
              title={bubble ? undefined : hint}
              style={lit && ({ '--provider-tile': lit.tile, '--provider-ink': lit.ink } as CSSProperties)}
            >
              <ReadmeButton
                brand="house"
                parts={[{ ...nameAndKind(providerName(p, t)), onClick: () => onPick(p) }]}
                mark={brandMark(p.mark)}
                markClass="text-carbon-textSub"
                hint={bubble}
              />
            </li>
          )
        })}
      </ul>

      {/* rclone backends with no provider entry, folded away but reachable. */}
      {unlisted.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer px-1 py-1 text-carbon-textMuted">
            {t('targets.pickMore', { count: unlisted.length })}
          </summary>
          <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
            {unlisted.map((b) => (
              <li key={b.name}>
                <button
                  type="button"
                  onClick={() => onPick(b.name)}
                  className="w-full truncate rounded-[var(--radius-pill)] bg-carbon-surface2 px-3 py-2 text-center text-dense text-carbon-text transition hover:bg-carbon-surface3"
                >
                  {b.name}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
