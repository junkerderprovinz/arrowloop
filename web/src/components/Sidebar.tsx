import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { api } from '../lib/api'
import { hueVars } from '../lib/appearance'
import { hidesLabel, type LabelMode } from '../lib/controls'
import { useT } from '../lib/i18n'
import { shudder } from '../lib/logoFlight'
import { onDestination, sidebarDestinations, type NavCounts, type NavDestination, type NavExtras } from '../lib/navModel'
import { Link, navigate } from '../lib/router'
import { HOLD, NO_STREAK, press } from '../lib/tapStreak'
import { IconSignOut } from './glyphs'
import { LogoLoop } from './LogoLoop'
import { LOGO_GOLD, LogoMark } from './LogoMark'
import { NavCount } from './NavCount'
import { useRainbow } from './Shell'

/**
 * The navigation rail, the same left rail the sibling apps use. Only glyph
 * mode narrows it; reactive mode keeps the full width so nothing moves when a
 * label appears under the pointer. A window too narrow for it gets the
 * BottomBar instead.
 */
const navBase =
  'glim-nav-row relative flex w-full items-center rounded-[var(--radius-pill)] px-3 py-2.5 text-[15px] font-medium transition duration-150 select-none'
const navActive = 'glim-active bg-accent text-accentContrast'
const navInactive = 'text-[var(--sidebar-text)] hover:bg-carbon-hover hover:text-carbon-text'

// In rainbow mode each glyph carries its entry's own hue.
const navHued = 'glim-hue glim-hue-icon'

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

function rowClass(mode: LabelMode, active: boolean): string {
  return `${navHued} ${navBase} group ${hidesLabel(mode) ? 'justify-center' : 'gap-3'} ${active ? navActive : navInactive}`
}

function Entry({
  destination,
  active,
  hue,
  mode,
  count,
}: {
  destination: NavDestination
  active: boolean
  hue: number
  mode: LabelMode
  count: number
}) {
  const { t } = useT()
  const label = t(destination.labelKey)
  const Icon = destination.icon
  const centred = hidesLabel(mode)
  return (
    <Link
      to={destination.to}
      style={hueVars(hue) as CSSProperties}
      // Glyph mode has no visible text to take the accessible name from.
      title={centred ? label : undefined}
      aria-label={mode === 'glyph' ? (count ? `${label}, ${count}` : label) : undefined}
      aria-current={active ? 'page' : undefined}
      className={rowClass(mode, active)}
    >
      {mode !== 'text' && <Icon />}
      <NavLabel label={label} mode={mode} />
      {/* In the centred modes the figure moves to the glyph's corner rather
          than disappearing. */}
      {count > 0 && <NavCount value={count} className={centred ? 'absolute end-1 top-1' : ''} />}
    </Link>
  )
}

/** Signing out drops this browser's cookie, and the reload brings the login back. */
function SignOut({ hue, mode }: { hue: number; mode: LabelMode }) {
  const { t } = useT()
  const label = t('login.logout')
  return (
    <button
      type="button"
      onClick={() => void api.logout().finally(() => window.location.reload())}
      style={hueVars(hue) as CSSProperties}
      title={hidesLabel(mode) ? label : undefined}
      aria-label={mode === 'glyph' ? label : undefined}
      className={rowClass(mode, false)}
    >
      {mode !== 'text' && <IconSignOut />}
      <NavLabel label={label} mode={mode} />
    </button>
  )
}

export function Sidebar({
  extras,
  counts,
  pathname,
  mode,
  signOut,
}: {
  extras: NavExtras
  counts: NavCounts
  pathname: string
  mode: LabelMode
  /** Whether a password is set, the one case where signing out means anything. */
  signOut: boolean
}) {
  // Re-rendered on palette changes, so an edited swatch shows here at once.
  useRainbow()
  const narrow = mode === 'glyph'
  const all = sidebarDestinations(extras)
  const list = all.filter((d) => !d.footer)
  const foot = all.filter((d) => d.footer)

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
      setFlight((n) => n + 1)
    }, HOLD)
  }

  function holdEnd() {
    if (held.current !== null) {
      window.clearTimeout(held.current)
      held.current = null
    }
  }

  function tapped() {
    const { next, fired } = press(streak.current, performance.now())
    streak.current = next
    if (fired) setFlight((n) => n + 1)
  }

  const entry = (d: NavDestination, hue: number): ReactNode => (
    <Entry
      key={d.to}
      destination={d}
      hue={hue}
      mode={mode}
      active={onDestination(pathname, d)}
      count={d.count ? counts[d.count] : 0}
    />
  )

  return (
    // Shaped as a card with the ground showing around it, but on the sidebar
    // surface, one step apart from the content it navigates. A window shorter
    // than the rows scrolls the rail instead of cutting off Settings.
    <aside
      ref={rail}
      data-nav-rail
      data-new="navigation"
      className={`flex h-full shrink-0 flex-col overflow-x-hidden overflow-y-auto rounded-card bg-carbon-sidebar ${
        narrow ? 'w-(--rail-narrow)' : 'w-56'
      }`}
    >
      {/* The narrow rail drops the wordmark and shrinks the mark to fit. The
          block steps its surface on hover like any unfilled control. */}
      <button
        type="button"
        onClick={() => {
          tapped()
          navigate(list[0]?.to ?? '/jobs')
        }}
        onPointerDown={holdStart}
        onPointerUp={holdEnd}
        onPointerLeave={holdEnd}
        onPointerCancel={holdEnd}
        className={`flex flex-col items-center gap-2 rounded-card transition-colors hover:bg-carbon-hover ${
          narrow ? 'px-2 py-4' : 'px-4 py-6'
        }`}
      >
        {/* Inline, so its two halves can move independently. LOGO_GOLD as
            the colour makes the rings the logo's own gold. */}
        <LogoMark
          key={flight}
          size={narrow ? 44 : 104}
          style={{ color: LOGO_GOLD }}
          className={`shrink-0 ${flight > 0 ? 'al-logo-morph' : ''}`}
        >
          {flight > 0 && <LogoLoop onRelease={shake} />}
        </LogoMark>
        {!narrow && <span className="al-wordmark text-xl font-bold tracking-tight text-carbon-text">ArrowLoop</span>}
      </button>

      <nav className={`flex flex-1 flex-col gap-1 ${narrow ? 'p-2' : 'p-3'}`}>{list.map((d, i) => entry(d, i))}</nav>

      <div className={`flex flex-col gap-1 ${narrow ? 'p-2' : 'p-3'}`}>
        {signOut && <SignOut hue={list.length} mode={mode} />}
        {foot.map((d, i) => entry(d, list.length + (signOut ? 1 : 0) + i))}
      </div>
    </aside>
  )
}
