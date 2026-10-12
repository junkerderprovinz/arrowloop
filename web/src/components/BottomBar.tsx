import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { api } from '../lib/api'
import { hueVars } from '../lib/appearance'
import { hidesLabel, type LabelMode } from '../lib/controls'
import { useLabelMode } from '../lib/glimstone/useLabelMode'
import { useT } from '../lib/i18n'
import { barDestinations, moreDestinations, onDestination, type NavCounts, type NavDestination } from '../lib/navModel'
import type { NavPins } from '../lib/navPins'
import { Link } from '../lib/router'
import { IconClose, IconMore, IconSignOut } from './glyphs'
import { NavCount } from './NavCount'
import { useRainbow } from './Shell'

/**
 * The rail of a narrow window: four places and More along the bottom, where a
 * thumb reaches them. It is a card inset from the edges like the rail, at a
 * fixed 48px whatever the label mode, so the page above never moves when a
 * setting changes.
 */
const slotBase =
  'glim-nav-row glim-hue glim-hue-icon flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-control text-meta'

function slotClass(active: boolean): string {
  return `${slotBase} ${active ? 'glim-active bg-accent text-accentContrast font-semibold' : 'text-carbon-textMuted'}`
}

/** The glyph over its word; in the hiding modes the word is the accessible name. */
function SlotFace({ icon, label, mode, count }: { icon: ReactNode; label: string; mode: LabelMode; count?: number }) {
  return (
    <>
      <span className="relative flex h-5 w-5 items-center justify-center [&_svg]:h-5 [&_svg]:w-5">
        {mode !== 'text' && icon}
        {count ? <NavCount value={count} quiet className="absolute -end-3 -top-1.5" /> : null}
      </span>
      <span className={`max-w-full truncate ${hidesLabel(mode) ? 'sr-only' : ''}`}>{label}</span>
    </>
  )
}

export function BottomBar({
  pins,
  counts,
  pathname,
  signOut,
}: {
  pins: NavPins
  counts: NavCounts
  pathname: string
  signOut: boolean
}) {
  const { t } = useT()
  useRainbow()
  const mode = useLabelMode('bottombar')
  const [open, setOpen] = useState(false)
  const slots = barDestinations(pins)
  const more = moreDestinations(pins)
  // Filled for the pages its sheet leads to, so somebody on one of them still
  // sees where they are.
  const moreActive = more.some((d) => onDestination(pathname, d))

  // A tap on the current place scrolls back to its top instead of stacking a
  // second history entry for the same page.
  const tap = (e: MouseEvent, d: NavDestination) => {
    if (pathname !== d.to) return
    e.preventDefault()
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <nav aria-label={t('nav.label')} className="shrink-0 pt-2">
      <div className="flex h-12 gap-1 rounded-card bg-carbon-sidebar p-1">
        {slots.map((d, i) => {
          const active = onDestination(pathname, d)
          const label = t(d.labelKey)
          const count = d.count ? counts[d.count] : 0
          const Icon = d.icon
          return (
            <Link
              key={d.to}
              to={d.to}
              onClick={(e) => tap(e, d)}
              aria-current={active ? 'page' : undefined}
              aria-label={hidesLabel(mode) && count ? `${label}, ${count}` : undefined}
              title={hidesLabel(mode) ? label : undefined}
              className={slotClass(active)}
              style={hueVars(i) as CSSProperties}
            >
              <SlotFace icon={<Icon />} label={label} mode={mode} count={count} />
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-current={moreActive ? 'true' : undefined}
          title={hidesLabel(mode) ? t('nav.more') : undefined}
          className={slotClass(moreActive)}
          style={hueVars(slots.length) as CSSProperties}
        >
          <SlotFace icon={<IconMore />} label={t('nav.more')} mode={mode} />
        </button>
      </div>
      {open && (
        <MoreSheet
          rows={more}
          counts={counts}
          pathname={pathname}
          signOut={signOut}
          hueOffset={slots.length + 1}
          onClose={() => setOpen(false)}
        />
      )}
    </nav>
  )
}

/**
 * The places without a slot, as a sheet from the bottom edge. Sign out is its
 * last row, since a narrow window has no rail to carry it.
 */
function MoreSheet({
  rows,
  counts,
  pathname,
  signOut,
  hueOffset,
  onClose,
}: {
  rows: NavDestination[]
  counts: NavCounts
  pathname: string
  signOut: boolean
  /** Where the rows continue the bar's palette, so no colour shows twice. */
  hueOffset: number
  onClose: () => void
}) {
  const { t } = useT()
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const row = 'flex min-h-12 items-center gap-3 rounded-control px-3 text-body hover:bg-carbon-hover'

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div aria-hidden className="glim-fade absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.more')}
        className="glim-page-enter relative m-2 flex flex-col gap-1 rounded-card bg-carbon-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between ps-3">
          <h2 className="text-title font-semibold text-carbon-text">{t('nav.more')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-10 w-10 items-center justify-center rounded-control text-carbon-textSub hover:bg-carbon-hover"
          >
            <IconClose />
          </button>
        </div>
        {rows.map((d, i) => {
          const active = onDestination(pathname, d)
          const count = d.count ? counts[d.count] : 0
          const Icon = d.icon
          return (
            <Link
              key={d.to}
              to={d.to}
              onClick={onClose}
              aria-current={active ? 'page' : undefined}
              className={`${row} glim-hue glim-hue-icon ${active ? 'glim-active bg-accent text-accentContrast' : 'text-carbon-text'}`}
              style={hueVars(hueOffset + i) as CSSProperties}
            >
              <span className="flex h-5 w-5 items-center justify-center [&_svg]:h-5 [&_svg]:w-5">
                <Icon />
              </span>
              <span className="min-w-0 flex-1 truncate">{t(d.labelKey)}</span>
              {count > 0 && <NavCount value={count} />}
            </Link>
          )
        })}
        {signOut && (
          <button
            type="button"
            onClick={() => void api.logout().finally(() => window.location.reload())}
            className={`${row} mt-2 text-carbon-textMuted`}
          >
            <span className="flex h-5 w-5 items-center justify-center [&_svg]:h-5 [&_svg]:w-5">
              <IconSignOut />
            </span>
            <span className="min-w-0 truncate">{t('login.logout')}</span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
