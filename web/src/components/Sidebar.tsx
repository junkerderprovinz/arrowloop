import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { hueVars, rainbowAt } from '../lib/appearance'
import { hidesLabel, type LabelMode } from '../lib/controls'
import { LOGO_GOLD, LogoMark } from './LogoMark'
import { HOLD, NO_STREAK, press } from '../lib/tapStreak'
import { useRainbow } from './Shell'

/**
 * The navigation rail, the same left rail the sibling apps use. Only glyph
 * mode narrows it; reactive mode keeps the full width so nothing moves when a
 * label appears under the pointer.
 */
const navBase =
  'glim-nav-row relative flex w-full items-center rounded-[var(--radius-control)] px-3 py-2.5 text-[15px] font-medium transition duration-150 select-none'
const navActive = 'glim-active bg-accent text-accentContrast'
const navInactive = 'text-[var(--sidebar-text)] hover:bg-carbon-hover hover:text-carbon-text'

// In rainbow mode each glyph carries its item's own hue.
const navHued = 'glim-hue glim-hue-icon'

export interface RailItem<T extends string> {
  value: T
  label: string
  icon: ReactNode
  /** A number worth watching without reading, such as the running jobs. */
  badge?: number
}

/**
 * The label for the given mode. In reactive mode it collapses to zero width in
 * a centred row, so the glyph rests in the middle and moves left as the label
 * grows back. The gap lives inside the span, since a row gap would push the
 * resting glyph off centre.
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
  const centred = hidesLabel(mode)
  return (
    <button
      type="button"
      onClick={() => onPick(item.value)}
      style={hueVars(rainbowAt(hue)) as CSSProperties}
      // Glyph mode has no visible text to take the accessible name from.
      title={centred ? item.label : undefined}
      aria-label={mode === 'glyph' ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={`${navHued} ${navBase} group ${centred ? 'justify-center' : 'gap-3'} ${
        active ? navActive : navInactive
      }`}
    >
      {mode !== 'text' && item.icon}
      <NavLabel label={item.label} mode={mode} />
      {/* On the active row the badge takes the ink colour; in the centred
          modes it moves to the glyph's corner rather than disappearing. */}
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
  // Re-rendered on palette changes, so an edited swatch shows here at once.
  useRainbow()

  const narrow = mode === 'glyph'

  // The easter egg: five quick presses on the logo, or a press and hold, send
  // the arrow flying out of its rings and back. The logo still navigates on
  // every press. The flight count remounts the mark, which replays the
  // animation even when it is asked for again.
  const [flight, setFlight] = useState(0)
  const streak = useRef(NO_STREAK)

  // Cleared on release and on leaving, so a press that turns into a drag does
  // not fire.
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
    setFlight((n) => n + 1)
  }

  function tapped() {
    const { next, fired } = press(streak.current, performance.now())
    streak.current = next
    if (fired) fly()
  }

  return (
    // Shaped as a card with the ground showing around it, but on the sidebar
    // surface, one step apart from the content it navigates. A window shorter
    // than the rows scrolls the rail instead of cutting off Settings.
    <aside
      className={`flex h-full shrink-0 flex-col overflow-x-hidden overflow-y-auto rounded-card bg-carbon-sidebar ${
        narrow ? 'w-(--rail-narrow)' : 'w-56'
      }`}
    >
      {/* The narrow rail drops the wordmark and shrinks the mark to fit. */}
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
        {/* Inline, so its two halves can move independently. LOGO_GOLD as
            the colour makes the rings the logo's own gold. */}
        <LogoMark
          key={flight}
          size={narrow ? 44 : 104}
          style={{ color: LOGO_GOLD }}
          className={`shrink-0 ${flight > 0 ? 'al-logo-loose' : ''}`}
        />
        {!narrow && (
          <span className="text-xl font-bold tracking-tight text-carbon-text">ArrowLoop</span>
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
