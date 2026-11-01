import type { CSSProperties, ReactNode } from 'react'

import { hueVars } from '../lib/appearance'
import { useT } from '../lib/i18n'

export interface Tile<T extends string> {
  id: T
  label: string
  /** The count in words, under the label. */
  detail: string
  /** The count alone, for the chips a phone-wide window draws. */
  count: number
}

/**
 * The tiles over a list page, which count what the list holds and pick what
 * it shows: everything, or one part of it. The rest of the page stays.
 *
 * BombVault's tile row and tiles, measure for measure: a glyph beside the name
 * over the count in words, as two rows of two below 860px and as one row of
 * chips with the number alone below 600px.
 */
export function Tiles<T extends string>({
  label,
  glyph,
  tiles,
  chosen,
  onChoose,
  children,
}: {
  /** What the row as a whole picks, read out for the group. */
  label: string
  glyph: ReactNode
  tiles: Tile<T>[]
  chosen: T
  onChoose: (tile: T) => void
  /** What narrows the list, under the tiles. */
  children?: ReactNode
}) {
  const { lang } = useT()
  const format = new Intl.NumberFormat(lang)
  return (
    <div role="group" aria-label={label} className="rounded-card bg-carbon-surface p-3 max-[600px]:p-2">
      <div className="flex flex-wrap gap-2 max-[860px]:grid max-[860px]:grid-cols-2 max-[600px]:flex max-[600px]:flex-nowrap max-[600px]:gap-1.5 max-[600px]:overflow-x-auto max-[600px]:[scrollbar-width:none]">
        {tiles.map((tile, i) => {
          const on = tile.id === chosen
          return (
            <button
              key={tile.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChoose(tile.id)}
              style={hueVars(i) as CSSProperties}
              className={`glim-hue glim-hue-icon grid min-w-max flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-card px-3 py-2 text-start transition-colors max-[860px]:min-w-0 max-[600px]:flex max-[600px]:flex-none max-[600px]:gap-x-1.5 max-[600px]:rounded-[var(--radius-pill)] max-[600px]:py-1.5 ${
                on ? 'glim-active bg-accent text-accentContrast' : 'bg-carbon-surface2 text-carbon-text hover:bg-carbon-surface3'
              }`}
            >
              <span className="row-span-2 flex [&_svg]:h-[22px] [&_svg]:w-[22px] max-[600px]:[&_svg]:h-4 max-[600px]:[&_svg]:w-4" aria-hidden>
                {glyph}
              </span>
              <span className="truncate text-body leading-5 font-semibold">{tile.label}</span>
              <span className="glim-num truncate text-meta leading-4 opacity-75 max-[600px]:hidden">{tile.detail}</span>
              <span className="glim-num hidden text-meta font-semibold opacity-70 max-[600px]:inline">{format.format(tile.count)}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-3 empty:hidden max-[600px]:mt-2">{children}</div>
    </div>
  )
}
