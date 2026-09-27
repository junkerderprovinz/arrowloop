import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { hueVars } from '../lib/appearance'
import { hidesLabel, type LabelMode } from '../lib/controls'
import { LogoLoop } from './LogoLoop'
import { shudder } from '../lib/logoFlight'
import { LOGO_GOLD, LogoMark } from './LogoMark'
import { HOLD, NO_STREAK, press } from '../lib/tapStreak'
import { useRainbow } from './Shell'

/**
 * The navigation rail, the same left rail the sibling apps use. Only glyph
 * mode narrows it; reactive mode keeps the full width so nothing moves when a
 * label appears under the pointer. A window too narrow for a rail beside the
 * page gets it as a bar of glyphs across the top instead.
 */
const navBase =
  'glim-nav-row relative flex items-center rounded-[var(--radius-pill)] px-3 py-2.5 text-[15px] font-medium transition duration-150 select-none'
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
  row,
  onPick,
}: {
  item: RailItem<T>
  active: boolean
  hue: number
  mode: LabelMode
  /** In the bar across the top, where the rows sit side by side. */
  row: boolean
  onPick: (next: T) => void
}) {
  const centred = hidesLabel(mode)
  return (
    <button
      type="button"
      onClick={() => onPick(item.value)}
      style={hueVars(hue) as CSSProperties}
      // Glyph mode has no visible text to take the accessible name from.
      title={centred ? item.label : undefined}
      aria-label={mode === 'glyph' ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={`${navHued} ${navBase} ${row ? 'w-auto' : 'w-full'} group ${centred ? 'justify-center' : 'gap-3'} ${
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

  const bar = useSmallWindow()
  const shown: LabelMode = bar ? 'glyph' : mode
  const narrow = shown === 'glyph'

  // The easter egg: five quick presses on the logo, or a press and hold, run
  // the arrows along the rings' gap into the middle, curl them into a ring that
  // spins up faster and faster, and shoot them out, and the rail shudders from
  // top to bottom. The logo still navigates on every press. The flight count
  // remounts the mark, which replays the animation even when it is asked for
  // again.
  const [flight, setFlight] = useState(0)
  const streak = useRef(NO_STREAK)
  const rail = useRef<HTMLElement>(null)

  function shake() {
    const amplitude = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-logo-shake'))
    if (!(amplitude > 0) || !rail.current) return
    const frames = shudder(amplitude)
    rail.current.querySelectorAll<HTMLElement>('.al-wordmark, .glim-nav-row').forEach((row, i) => {
      row.animate(frames, { duration: 400, delay: i * 45 })
    })
  }

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
      ref={rail}
      className={`flex shrink-0 rounded-card bg-carbon-sidebar ${
        bar
          ? 'w-full flex-row items-center overflow-x-auto'
          : `h-full flex-col overflow-x-hidden overflow-y-auto ${narrow ? 'w-(--rail-narrow)' : 'w-56'}`
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
          bar ? 'p-2' : narrow ? 'px-2 py-4' : 'px-4 py-6'
        }`}
      >
        {/* Inline, so its two halves can move independently. LOGO_GOLD as
            the colour makes the rings the logo's own gold. */}
        <LogoMark
          key={flight}
          size={bar ? 36 : narrow ? 44 : 104}
          style={{ color: LOGO_GOLD }}
          className={`shrink-0 ${flight > 0 ? 'al-logo-morph' : ''}`}
        >
          {flight > 0 && <LogoLoop onRelease={shake} />}
        </LogoMark>
        {!narrow && (
          <span className="al-wordmark text-xl font-bold tracking-tight text-carbon-text">ArrowLoop</span>
        )}
      </button>

      <nav className={`flex flex-1 gap-1 ${bar ? 'flex-row justify-center p-2' : narrow ? 'flex-col p-2' : 'flex-col p-3'}`}>
        {items.map((item, i) => (
          <Item
            key={item.value}
            item={item}
            hue={i}
            mode={shown}
            row={bar}
            active={item.value === value}
            onPick={onChange}
          />
        ))}
      </nav>

      <div className={`flex gap-1 ${bar ? 'flex-row p-2' : narrow ? 'flex-col p-2' : 'flex-col p-3'}`}>
        <Item
          item={settings}
          hue={items.length}
          mode={shown}
          row={bar}
          active={settings.value === value}
          onPick={onChange}
        />
      </div>
    </aside>
  )
}

/** The width below which the rail turns into the bar across the top. */
const SMALL_WINDOW = '(max-width: 639px)'

function useSmallWindow(): boolean {
  const [small, setSmall] = useState(() => window.matchMedia(SMALL_WINDOW).matches)
  useEffect(() => {
    const query = window.matchMedia(SMALL_WINDOW)
    const follow = () => setSmall(query.matches)
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])
  return small
}
