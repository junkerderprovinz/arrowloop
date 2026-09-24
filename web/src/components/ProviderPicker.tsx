import { brandMark } from './brandMarks'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { useLabelMode } from '../lib/glimstone/useLabelMode'
import { useT } from '../lib/i18n'
import type { Backend, Provider } from '../lib/api'

/**
 * Picks what a target connects to by product name rather than by protocol, as
 * a grid of tiles in the style of KnightLoader's extension tiles.
 * Only the protocol tiles carry a hint, in an info bubble, since a cloud's name
 * already says what it is. The order is alphabetical, set in the Go table.
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
  const { t } = useT()
  const showHint = (p: Provider) => p.group === 'protocol' && Boolean(p.hint)

  // The tiles follow the label setting, except that reactive shows names like
  // text-and-glyph: hiding them until hovered would defeat a list somebody is
  // searching by name.
  const mode = useLabelMode('buttons')
  const showMark = mode !== 'text'
  // A provider with no logo keeps its name even in glyph mode, or its tile
  // would be an empty box.
  const showName = (p: Provider) => mode !== 'glyph' || !brandMark(p.mark)

  return (
    <div className="flex flex-col gap-4">
      {/* As many across as the window is wide, each tile at least the mark
          box plus its padding; the mark box is wide because several marks are
          wordmarks (Linkbox is 5.3:1). The window scrolls the list. */}
      <ul className="grid w-full grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
        {providers.map((p) => (
          <li key={p.id} className="relative">
            <button
              type="button"
              onClick={() => onPick(p)}
              title={p.hint || undefined}
              className={TILE}
            >
              {/* Every mark carries width="1em", so a max-size cap never fires;
                  full size lets the viewBox letterbox the mark into the box. */}
              {showMark && (
                <span className="flex h-12 w-24 shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full">
                  {brandMark(p.mark)}
                </span>
              )}
              {showName(p) && (
                <span className="w-full px-1 text-center">
                  <span className="block break-words text-dense font-medium leading-tight">
                    {p.name}
                  </span>
                </span>
              )}
            </button>
            {/* A sibling of the button, so a click on the bubble does not also
                pick the provider. */}
            {p.hint && showHint(p) && (
              <span className="absolute end-1.5 top-1.5">
                <InfoBubble tip={p.hint} />
              </span>
            )}
          </li>
        ))}
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
                  title={b.description}
                  className="w-full truncate rounded-[var(--radius-control)] bg-carbon-surface2 px-3 py-2 text-center text-dense text-carbon-text transition hover:bg-carbon-surface3"
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

/**
 * One tile: the mark above the name, the tile itself the button.
 *
 * The hover is GlimStone's tile hover, a light grey on the dark theme and
 * surface3 on the light one, with its own dark ink. On the light grey a
 * dark-theme mark would fade, so `brand-hover-light` switches each mark to its
 * light value (generated in brandGlyphs.css). The keyboard focus ring is kept.
 */
const TILE =
  'brand-hover-light flex h-full w-full flex-col items-center justify-center gap-2 ' +
  'rounded-[var(--radius-control)] bg-carbon-surface2 px-2 py-3 text-carbon-text ' +
  'transition-colors duration-150 ' +
  'hover:bg-(--carbon-tile-hover) hover:text-(--carbon-tile-hover-ink)'
