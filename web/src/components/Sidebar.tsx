import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { hueVars, rainbowAt } from '../lib/appearance'
import { hidesLabel, type LabelMode } from '../lib/controls'
import { LOGO_GOLD, LogoMark } from './LogoMark'
import { useRainbow } from './Shell'

/**
 * The navigation rail.
 *
 * A left rail rather than a strip of tabs across the top, because that is what
 * every other program in this house has and jdp said so in one line: the layout
 * is meant to be the same one, not a second arrangement that happens to work.
 * The practical difference is that the rail is a fixed column the page never
 * competes with, so a wide table and a narrow settings form sit in the same
 * frame instead of each pushing the navigation around.
 *
 * The four label modes all live here, and glyph-only is the one that narrows
 * the rail: with no label ever drawn there is nothing to be wide for. The
 * hover mode keeps the full width on purpose, because its whole promise is that
 * nothing moves when the pointer arrives, and a rail that widened to fit the
 * word it reveals would break that on the first mouseover.
 */
const navBase =
  'relative flex w-full items-center rounded-[var(--radius-control)] px-3 py-2.5 text-[15px] font-medium transition duration-150 select-none'
const navActive = 'glim-active bg-accent text-accentContrast'
const navInactive = 'text-[var(--sidebar-text)] hover:bg-carbon-hover hover:text-carbon-text'

// In rainbow mode the glyph carries the item's own hue, so the rail and the
// mark agree and the navigation reads as a set rather than as one gold entry
// and four grey ones. Without the mode the rule never matches.
const navHued = 'glim-hue glim-hue-icon'

export interface RailItem<T extends string> {
  value: T
  label: string
  icon: ReactNode
  /** A number worth watching without reading, such as jobs running now. */
  badge?: number
}

/**
 * The label, in whichever of the four states the mode asks for.
 *
 * The reactive mode renders it and collapses it to nothing rather than leaving
 * it out, and that IS the mechanism: the row is centred, so a label of zero
 * width leaves the glyph in the middle, and a label that grows back pushes the
 * glyph left into exactly the position it holds when the words are permanent.
 * Nothing is measured and the row's own box never changes size.
 *
 * The gap between glyph and label lives inside this span rather than on the row,
 * because a row gap survives its neighbour collapsing to zero and would leave
 * the resting glyph off centre by exactly that gap.
 */
function NavLabel({ label, mode }: { label: string; mode: LabelMode }) {
  if (mode === 'glyph') return null
  if (mode !== 'reactive') return <span className="flex-1 text-start">{label}</span>
  return (
    <span
      className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200
        group-hover:ps-3 group-hover:max-w-40 group-hover:opacity-100
        group-focus-visible:ps-3 group-focus-visible:max-w-40 group-focus-visible:opacity-100"
    >
      {label}
    </span>
  )
}

function Item<T extends string>({
  item,
  active,
  hue,
  mode,
  onPick,
}: {
  item: RailItem<T>
  active: boolean
  hue: number
  mode: LabelMode
  onPick: (next: T) => void
}) {
  // Centred whenever the label is not permanently present, which covers
  // glyph-only (there is nothing else in the row) and reactive (where the
  // centring is what does the work).
  const centred = hidesLabel(mode)
  return (
    <button
      type="button"
      onClick={() => onPick(item.value)}
      style={hueVars(rainbowAt(hue)) as CSSProperties}
      // The accessible name comes from the visible text in three of the four
      // modes. Glyph-only has no visible text at all, so it says the name
      // itself rather than announcing as an unlabelled control.
      title={centred ? item.label : undefined}
      aria-label={mode === 'glyph' ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={`${navHued} ${navBase} group ${centred ? 'justify-center' : 'gap-3'} ${
        active ? navActive : navInactive
      }`}
    >
      {mode !== 'text' && item.icon}
      <NavLabel label={item.label} mode={mode} />
      {/* On the filled active row the badge sits on the accent, so it borrows
          the ink colour instead of the surface tint it wears when idle. In both
          centred modes it moves to the corner of the glyph rather than
          disappearing: a run in progress is worth the two characters, and it is
          the one thing in this rail somebody watches without reading. */}
      {item.badge ? (
        <span
          className={`glim-num rounded-[var(--radius-pill)] bg-carbon-surface3/60 px-1.5 py-0.5 text-xs font-semibold leading-none text-carbon-textSub [.glim-active_&]:bg-black/15 [.glim-active_&]:text-current ${
            centred ? 'absolute end-1 top-1' : ''
          }`}
        >
          {item.badge}
        </span>
      ) : null}
    </button>
  )
}

export function Sidebar<T extends string>({
  items,
  settings,
  value,
  onChange,
  mode,
}: {
  items: RailItem<T>[]
  /** The one that sits at the foot of the rail, away from the rest. */
  settings: RailItem<T>
  value: T
  onChange: (next: T) => void
  mode: LabelMode
}) {
  // Subscribed rather than read: the rail re-renders when the palette or the
  // mode changes, so editing a swatch in the settings is visible here at once
  // instead of on the next navigation.
  useRainbow()

  const narrow = mode === 'glyph'

  /**
   * The easter egg: five quick presses and the arrow gets loose.
   *
   * The mark is an arrow bent into a loop, so the one thing it can do that no
   * other logo could is come unbent - fly out of its own rings, round the
   * outside, and back in. Which is the product's sentence: what goes out comes
   * back.
   *
   * Five WITHIN a couple of seconds, counted from the last press rather than
   * from the first, so an ordinary click on the way to the jobs tab never
   * accumulates towards it over an afternoon. The button keeps navigating on
   * every press, including the fifth: an easter egg that swallows the control
   * it hides behind is a bug.
   */
  const [loose, setLoose] = useState(0)
  const taps = useRef({ count: 0, at: 0 })

  function tapped() {
    const now = performance.now()
    const seen = now - taps.current.at < 600 ? taps.current.count + 1 : 1
    taps.current = { count: seen, at: now }
    if (seen >= 5) {
      taps.current.count = 0
      // The key CHANGES rather than a flag going true. The flight is an
      // animation on a class, so it plays when the class arrives; a flag
      // already set plays nothing the second time, which is exactly the press
      // somebody makes when they liked it. Same trick, and the same reason, as
      // the shake on a refused save.
      setLoose((n) => n + 1)
    }
  }

  return (
    <aside
      className={`flex h-full shrink-0 flex-col bg-carbon-sidebar ${narrow ? 'w-16' : 'w-56'}`}
    >
      {/* The mark above its name, centred. The narrow rail drops the wordmark
          and shrinks the mark to fit: a large logo in a 64px column is not a
          smaller logo, it is a cropped one, and the name beside it would have
          nowhere to go. */}
      <button
        type="button"
        onClick={() => {
          tapped()
          onChange(items[0]?.value ?? value)
        }}
        className={`flex flex-col items-center gap-2 transition-opacity hover:opacity-90 ${
          narrow ? 'px-2 py-4' : 'px-4 py-6'
        }`}
      >
        {/* Drawn inline rather than loaded as an image, which is what lets its
            two halves move independently. As the logo rather than as a status
            mark, so the rings take the drawing's own gold: `currentColor` is
            the colour they are mixed from, and LOGO_GOLD is what the file
            itself uses. */}
        <LogoMark
          key={loose}
          size={narrow ? 36 : 80}
          style={{ color: LOGO_GOLD }}
          className={`shrink-0 ${loose > 0 ? 'al-logo-loose' : ''}`}
        />
        {!narrow && (
          <span className="text-[19px] font-semibold tracking-tight text-carbon-text">
            Arrow<span className="text-accentInk">Loop</span>
          </span>
        )}
      </button>

      <nav className={`flex flex-1 flex-col gap-1 ${narrow ? 'p-2' : 'p-3'}`}>
        {items.map((item, i) => (
          <Item
            key={item.value}
            item={item}
            hue={i}
            mode={mode}
            active={item.value === value}
            onPick={onChange}
          />
        ))}
      </nav>

      {/* Settings sits at the foot, separated from the rest, the same place it
          sits in the other programs here. It is where somebody goes to change
          the app rather than to use it. */}
      <div className={`flex flex-col gap-1 ${narrow ? 'p-2' : 'p-3'}`}>
        <Item
          item={settings}
          hue={items.length}
          mode={mode}
          active={settings.value === value}
          onPick={onChange}
        />
      </div>
    </aside>
  )
}
