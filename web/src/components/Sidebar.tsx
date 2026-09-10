import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { hueVars, rainbowAt } from '../lib/appearance'
import { hidesLabel, type LabelMode } from '../lib/controls'
import { LOGO_GOLD, LogoMark } from './LogoMark'
import { HOLD, NO_STREAK, press } from '../lib/tapStreak'
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
   * The easter egg: five presses and the arrow gets loose.
   *
   * The mark is an arrow bent into a loop, so the one thing it can do that no
   * other logo could is come unbent - fly out of its own rings, round the
   * outside, and back in. Which is the product's sentence: what goes out comes
   * back.
   *
   * The counting lives in lib/tapStreak, and it was moved there because of how
   * this shipped: the window was 600ms between presses, set on the evidence of
   * a script clicking five times in the same millisecond. Under a real hand the
   * streak reset every time and the whole thing did not exist. jdp: "das easter
   * egg geht nicht." Out there, the window can be checked at human intervals
   * with no browser and no clock.
   *
   * The button keeps navigating on every press, including the fifth: an easter
   * egg that swallows the control it hides behind is a bug.
   */
  /**
   * How many flights have been asked for. The COUNT is the whole state.
   *
   * It briefly also tracked "in the air right now", cleared on
   * `onAnimationEnd`, so that the class would be an honest reading of the
   * state. Measured in the browser, that handler did not fire: the animations
   * run on the two GROUPS inside the drawing while the handler sat on the svg
   * around them, and the class stayed on for good. It is gone rather than
   * propped up with a timer, because it bought exactly one thing - a class that
   * could be read as "is it flying" - and there is a better answer to that
   * question anyway. Ask the browser what it is PLAYING (`getAnimations()`),
   * never what classes an element carries: a class that goes on once and stays
   * makes "is it flying" and "has it ever flown" the same question, which is
   * how this feature's own timing bug survived being measured in the first
   * place. What the class leaves behind between flights is `overflow: visible`,
   * which changes nothing.
   */
  const [flight, setFlight] = useState(0)
  const streak = useRef(NO_STREAK)

  /**
   * The other way in: press and hold.
   *
   * Added because the first one was reported as broken by somebody trying it:
   * "das easter egg funktioniert nicht, ein langer klick macht nichts". Five
   * presses is a convention you have to be told about, and an easter egg
   * nobody can find is not one. Holding is what people actually try.
   *
   * The timer is cleared on release and on the pointer leaving, so a press that
   * turns into a drag does not fire it, and the click still navigates either
   * way.
   */
  const held = useRef<number | null>(null)

  function holdStart() {
    if (held.current !== null) window.clearTimeout(held.current)
    held.current = window.setTimeout(() => {
      held.current = null
      fly()
    }, HOLD)
  }

  function holdEnd() {
    if (held.current !== null) {
      window.clearTimeout(held.current)
      held.current = null
    }
  }

  function fly() {
      // A COUNTER rather than a flag going true. The flight is an animation on
      // a class, so it plays when the class arrives; a flag already true adds
      // no class and plays nothing, which is exactly the press somebody makes
      // when they liked it and want it again. Same trick, and the same reason,
      // as the shake on a refused save.
    setFlight((n) => n + 1)
  }

  function tapped() {
    const { next, fired } = press(streak.current, performance.now())
    streak.current = next
    if (fired) fly()
  }

  return (
    // A card, not a wall. It carries the same radius and the same raised
    // surface every other card on the page has, and the ground shows around it
    // on all four sides. jdp: "koennen wir bei AL mal die sidebar testweise
    // anders gestalten? Naemlich als card."
    //
    // The surface token stays `carbon-sidebar` rather than becoming the card
    // surface: the rail is still navigation and reads better one step apart
    // from the content it navigates. What changes is its SHAPE, which was the
    // report - it looked welded to the window while everything else floated.
    // No shadow either, because no card in this app has one: a raised rail
    // beside flat cards would trade one inconsistency for another.
    // The narrow width is `--rail-narrow`, the house's 85px, and no longer this
    // app's own sum. It used to be 64px, worked out from the 44px mark plus the
    // rows' `p-2`; the sibling worked out 96px the same way from its own mark,
    // and the two rails then did the same job at different widths. The mark
    // fits the rail now: 44px still sits centred at 85, with more air than it
    // had.
    <aside
      className={`flex h-full shrink-0 flex-col overflow-hidden rounded-card bg-carbon-sidebar ${
        narrow ? 'w-(--rail-narrow)' : 'w-56'
      }`}
    >
      {/* The mark above its name, centred. The narrow rail drops the wordmark
          and shrinks the mark to fit: a large logo in a narrow column is not a
          smaller logo, it is a cropped one, and the name beside it would have
          nowhere to go. */}
      <button
        type="button"
        onClick={() => {
          tapped()
          onChange(items[0]?.value ?? value)
        }}
        onPointerDown={holdStart}
        onPointerUp={holdEnd}
        onPointerLeave={holdEnd}
        onPointerCancel={holdEnd}
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
          key={flight}
          size={narrow ? 44 : 104}
          style={{ color: LOGO_GOLD }}
          className={`shrink-0 ${flight > 0 ? 'al-logo-loose' : ''}`}
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
