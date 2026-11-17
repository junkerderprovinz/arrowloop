import type { CSSProperties, ReactNode } from 'react'
import { ReadmeButton } from '../lib/glimstone/ReadmeButton'
import { useT } from '../lib/i18n'
import { nameAndKind } from '../lib/optionHint'

export type PickTile = {
  id: string
  /** The name shown, which is also the button's accessible name. */
  name: string
  mark?: ReactNode
  /** A brand's colour pair from BRAND_TILES. Without one the tile lights up in the accent. */
  lit?: { tile: string; ink: string }
  hint?: string
  /** Puts the hint in an info bubble rather than in a tooltip. */
  bubble?: boolean
  /** The What's new entry whose dot sits on this tile. */
  newId?: string
}

/**
 * A picker's choices as README buttons, the mark at the start and the name
 * beside it, as many across as the window is wide and each at least the
 * README button's width. The order is alphabetical by the name shown.
 */
export function PickTiles({ tiles, onPick }: { tiles: PickTile[]; onPick: (id: string) => void }) {
  const { lang } = useT()
  const sorted = [...tiles].sort((a, b) => a.name.localeCompare(b.name, lang, { sensitivity: 'base' }))

  return (
    <ul className="glim-provider-pick">
      {sorted.map((tile) => (
        <li
          key={tile.id}
          data-new={tile.newId}
          title={tile.bubble ? undefined : tile.hint}
          style={tile.lit && ({ '--provider-tile': tile.lit.tile, '--provider-ink': tile.lit.ink } as CSSProperties)}
        >
          <ReadmeButton
            brand="house"
            parts={[{ ...nameAndKind(tile.name), onClick: () => onPick(tile.id) }]}
            mark={tile.mark}
            markClass="text-carbon-textSub"
            hint={tile.bubble ? tile.hint : undefined}
          />
        </li>
      ))}
    </ul>
  )
}
