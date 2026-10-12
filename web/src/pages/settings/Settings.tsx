import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

import type { WindowSettings } from '../../lib/api'
import type { TabId } from '../../lib/routes'
import { Apps } from '../Apps'
import { Security } from '../Security'
import { GeneralPage } from './GeneralPage'
import { InfoPage } from './InfoPage'
import { LookPage, type LookProps } from './LookPage'
import { SafetyPage } from './SafetyPage'
import { SettingsTabs } from './SettingsTabs'
import { jumpTarget, markHit, SettingsSearch, takeJump } from './SettingsSearch'
import { SyncPage } from './SyncPage'
import { rememberTab, type SettingsTab } from './tabs'
import { TargetsTab } from './TargetsTab'

export interface SettingsProps {
  tab: TabId
  tabs: SettingsTab[]
  look: LookProps
  version: string
  window: WindowSettings | null
  onWindow: (next: WindowSettings) => void
  /** The Targets page, which its tab draws whole. */
  targets: ReactNode
  /** The list of what the last update changed, for the Info tab. */
  whatsNew?: ReactNode
}

/** How long a search result waits for its tab's cards, which may still be reading the settings. */
const JUMP_PATIENCE_MS = 2000

/**
 * Settings as a strip of tabs across the page and the open tab's cards under
 * it. The strip scrolls with the page, and the search waits above it until
 * somebody scrolls up for it.
 */
export function Settings(props: SettingsProps) {
  const { tab, tabs } = props
  const wide = tabs.find((x) => x.id === tab)?.wide ?? false
  const content = useRef<HTMLDivElement>(null)

  // The side a new tab's cards slide in from: 1 for one further along the
  // strip, -1 for one before it, 0 on arrival.
  const previous = useRef<TabId | null>(null)
  const order = tabs.map((x) => x.id)
  const toward =
    previous.current === null || previous.current === tab
      ? 0
      : order.indexOf(tab) > order.indexOf(previous.current)
        ? 1
        : -1
  useEffect(() => {
    previous.current = tab
    rememberTab(tab)
  }, [tab])

  useEffect(() => {
    const jump = takeJump()
    if (!jump) return
    const started = performance.now()
    let frame = 0
    const look = () => {
      const el = content.current && jumpTarget(content.current, jump)
      const late = performance.now() - started >= JUMP_PATIENCE_MS
      // A tab that is still reading its settings shows a card of the same
      // name without the row, so the card alone is taken only at the end.
      const found = el && (!jump.row || el.dataset.glimLabel === jump.row || late)
      if (found) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        markHit(el)
      } else if (!late) {
        frame = requestAnimationFrame(look)
      }
    }
    frame = requestAnimationFrame(look)
    return () => cancelAnimationFrame(frame)
  }, [tab])

  return (
    <div
      ref={content}
      data-settings-content
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-10 overflow-y-auto pb-[var(--page-gutter)] sm:px-6 md:px-8"
    >
      <div className="flex w-full flex-col">
        {/* The search ends where the cards below it do. */}
        <SettingsSearch tabs={tabs} tab={tab} wide={wide} />
        <SettingsTabs tabs={tabs} active={tab} />
      </div>
      {/* The cap belongs to the page: a form of rows with a name at one end
          and a control at the other is held to 880px so the two stay
          together in a wide window. */}
      <div
        key={tab}
        className={`glim-page-enter flex w-full flex-col gap-10${wide ? '' : ' max-w-[880px]'}${toward ? ' glim-tab-slide' : ''}`}
        style={{ '--tab-dir': toward } as CSSProperties}
      >
        <TabPage {...props} />
      </div>
    </div>
  )
}

function TabPage({ tab, look, version, window, onWindow, targets, whatsNew }: SettingsProps) {
  switch (tab) {
    case 'general':
      return <GeneralPage window={window} onWindow={onWindow} />
    case 'look':
      return <LookPage {...look} />
    case 'sync':
      return <SyncPage />
    case 'safety':
      return <SafetyPage />
    case 'targets':
      return <TargetsTab page={targets} />
    case 'security':
      return <Security />
    case 'apps':
      return <Apps version={version} desktop={window !== null} />
    case 'info':
      return <InfoPage version={version} whatsNew={whatsNew} />
  }
}
