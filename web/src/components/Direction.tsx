import type { CSSProperties } from 'react'

import { hueVars, rainbowAt } from '../lib/appearance'
import { KEY_CONTROL_H } from './Field'
import { IconBothWays, IconToLeft, IconToRight } from './glyphs'
import { useT, type TranslationKey } from '../lib/i18n'
import type { Direction } from '../lib/api'

/**
 * Which way a job may write, drawn as arrows because they take the same room
 * in every language. The word stays as the hover bubble and accessible name.
 */
export const DIRECTIONS: Direction[] = ['both', 'leftToRight', 'rightToLeft']

export const directionKey: Record<Direction, TranslationKey> = {
  both: 'direction.both',
  leftToRight: 'direction.toRight',
  rightToLeft: 'direction.toLeft',
}

export function DirectionGlyph({ direction, size }: { direction: Direction; size?: number }) {
  // Where the two sides are set larger, the arrow between them grows too.
  const box = size ? { width: size, height: size } : {}
  if (direction === 'leftToRight') return <IconToRight {...box} />
  if (direction === 'rightToLeft') return <IconToLeft {...box} />
  return <IconBothWays {...box} />
}

/** The direction of a job as it appears between the two sides in a list. */
export function DirectionMark({ direction, size }: { direction: Direction; size?: number }) {
  const { t } = useT()
  const name = t(directionKey[direction])
  return (
    <span
      className="inline-flex shrink-0 items-center text-carbon-textMuted"
      data-tip={name}
      aria-label={name}
      role="img"
    >
      <DirectionGlyph direction={direction} size={size} />
    </span>
  )
}

/** The next direction in the cycle, wrapping back to both ways. */
export function nextDirection(current: Direction): Direction {
  const at = DIRECTIONS.indexOf(current)
  return DIRECTIONS[(at + 1) % DIRECTIONS.length]
}

/**
 * The editable direction, placed between the two sides it relates so the row
 * reads as one sentence. Clicking or an arrow key cycles through the three
 * answers, and the accessible name always says which one is current.
 */
export function DirectionSwitch({
  direction,
  onChange,
  hint,
}: {
  direction: Direction
  onChange: (next: Direction) => void
  /** What the three answers mean, shown in the same bubble as the current one. */
  hint?: string
}) {
  const { t } = useT()
  const name = t(directionKey[direction])
  // Two sentences, so neither half has to be translated to fit the other.
  const tip = hint ? `${name}. ${hint}` : name

  return (
    <button
      type="button"
      onClick={() => onChange(nextDirection(direction))}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(nextDirection(direction))
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          // Two steps forward in a three-cycle is one step back.
          onChange(nextDirection(nextDirection(direction)))
        }
      }}
      data-tip={tip}
      aria-label={`${t('direction.label')}: ${name}`}
      className={`glim-btn glim-btn-key glim-hue inline-flex ${KEY_CONTROL_H} w-[var(--btn-h-key)] shrink-0 items-center justify-center bg-carbon-surface2 text-carbon-text transition-colors hover:bg-carbon-surface3`}
      style={{ borderRadius: 'var(--radius-control)', ...(hueVars(rainbowAt(0)) as CSSProperties) }}
    >
      {/* A glyph with no label sibling; index.css keeps it visible in text
          mode, where it is the label. */}
      <span className="glim-btn-glyph" aria-hidden>
        {/* No size prop: `.glim-btn-key` sizes the mark in CSS, which a width
            attribute on the svg would lose to anyway. */}
        <DirectionGlyph direction={direction} />
      </span>
    </button>
  )
}
