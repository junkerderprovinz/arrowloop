import { BRAND_TILES } from './brandGlyphs'
import { brandMark } from './brandMarks'
import { PickTiles } from './PickTiles'
import { useT } from '../lib/i18n'
import { providerHint, providerName } from '../lib/optionHint'
import type { Backend, Provider } from '../lib/api'

/** The rows whose mark a What's new entry points at, by provider id. */
const NEW_MARKS: Record<string, string> = { synologyc2: 'provider-marks', filefabric: 'provider-marks' }

/**
 * Picks what a target connects to by product name rather than by protocol. A
 * provider with a brand lights up in the brand's colour from BRAND_TILES; a
 * protocol wears one of the app's own glyphs and lights up in the accent. Only
 * the protocols and the targets built on another one carry their hint in an
 * info bubble, since a cloud's name already says what it is.
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

  return (
    <div className="flex flex-col gap-4">
      <PickTiles
        tiles={providers.map((p) => ({
          id: p.id,
          name: providerName(p, t),
          mark: brandMark(p.mark),
          lit: p.mark ? BRAND_TILES[p.mark] : undefined,
          hint: providerHint(p.id, t),
          bubble: p.group === 'protocol' || p.group === 'layered',
          newId: NEW_MARKS[p.id],
        }))}
        onPick={(id) => onPick(providers.find((p) => p.id === id)!)}
      />

      {/* rclone backends with no provider entry, after the products and
          smaller, since few people look for a protocol by its rclone name. */}
      {unlisted.length > 0 && (
        <section className="flex flex-col gap-2 text-meta">
          <h4 className="px-1 text-carbon-textMuted">{t('targets.pickMore', { count: unlisted.length })}</h4>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
            {unlisted.map((b) => (
              <li key={b.name}>
                <button
                  type="button"
                  onClick={() => onPick(b.name)}
                  className="w-full truncate rounded-[var(--radius-pill)] bg-carbon-surface2 px-3 py-2 text-center text-meta text-carbon-text transition hover:bg-hover"
                >
                  {b.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
