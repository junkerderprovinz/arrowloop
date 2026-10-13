import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { followSettings } from '../../lib/anomalyModule'
import { api, type Settings } from '../../lib/api'
import { Card } from '../../lib/glimstone/Card'
import { errorText } from '../../lib/errorText'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'

/**
 * Writes wait for a value to settle, or a text box would send a request per
 * keystroke and the bandwidth limit would refuse "1" on the way to "1M".
 */
const SETTLE_MS = 700

// One copy for every tile. Two tiles show parts of the same fields, such as
// the defaults, and a copy each would let one tile write its stale part back
// over what the other just changed.
let shared: { loaded: Settings | null; draft: Settings; error: string | null } = { loaded: null, draft: {}, error: null }
const watchers = new Set<() => void>()
/** The fields changed since the last save, the only ones a save sends. */
const changed = new Set<keyof Settings>()
/** The saves under way, in order, so a read waits for what they write. */
let saves: Promise<unknown> = Promise.resolve()
let saving = 0
let timer: ReturnType<typeof setTimeout> | null = null

function update(next: Partial<typeof shared>) {
  shared = { ...shared, ...next }
  for (const watcher of watchers) watcher()
}

function subscribe(watcher: () => void) {
  watchers.add(watcher)
  return () => {
    watchers.delete(watcher)
  }
}

/** The changed fields as they stand in the draft, null for one cleared, which the engine then removes. */
function unsaved(): Settings {
  const out: Record<string, unknown> = {}
  for (const key of changed) out[key] = shared.draft[key] ?? null
  return out as Settings
}

function send(): Promise<Settings> {
  if (timer) clearTimeout(timer)
  timer = null
  const body = unsaved()
  changed.clear()
  const go = () => api.saveSettings(body)
  // Sent at once when nothing is under way, so a tile that closes has its
  // change on the wire before the next tile reads.
  const sent = saving > 0 ? saves.then(go) : go()
  saving++
  saves = sent
    .catch(() => undefined)
    .then(() => {
      saving--
    })
  return sent
}

function read() {
  saves
    .then(() => api.settings())
    .then((got) => {
      // A field changed while the read was under way keeps what was typed.
      update({ loaded: got, draft: { ...got, ...unsaved() }, error: null })
      followSettings(got)
    })
    .catch((e: Error) => update({ error: e.message }))
}

/**
 * The engine settings the General, Sync and Safety tiles show, saved as they
 * change. A save is quiet; a refusal says so in a toast, since the field that
 * caused it may be far up a long page.
 */
export function useEngineSettings() {
  const { t } = useT()
  const push = useToast()
  const { loaded, draft, error } = useSyncExternalStore(subscribe, () => shared)

  // Read again on every opening, for a change made in another window. A
  // change still waiting to settle is sent when the tile closes rather than
  // lost; nothing is left on screen to take the answer.
  useEffect(() => {
    read()
    return () => {
      if (timer) void send().catch(() => {})
    }
  }, [])

  const patch = useCallback(
    (next: Partial<Settings>) => {
      for (const key of Object.keys(next) as (keyof Settings)[]) changed.add(key)
      update({ draft: { ...shared.draft, ...next } })
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        send()
          .then((saved) => {
            // Only `loaded` takes the answer: replacing the draft would
            // overwrite a box somebody is still typing in.
            update({ loaded: saved })
            followSettings(saved)
          })
          .catch((e) => push(errorText(t, e), 'fail'))
      }, SETTLE_MS)
    },
    [push, t],
  )

  return { loaded, draft, patch, error }
}

export type EngineSettings = ReturnType<typeof useEngineSettings>

/**
 * The stored retry wait, a Go duration, as whole minutes. Anything unreadable
 * shows the engine's built-in default, which is what then applies.
 */
export function waitMinutes(raw: string | undefined): number {
  const match = /^(\d+)(m|h)$/.exec(raw ?? '')
  if (!match) return 5
  const n = Number(match[1])
  return match[2] === 'h' ? n * 60 : n
}

/** Stands in for a tile's cards until the settings have been read. */
export function Reading({ title, error, hueIndex = 0 }: { title: string; error: string | null; hueIndex?: number }) {
  const { t } = useT()
  return (
    <Card title={title} hueIndex={hueIndex}>
      <p className="text-subline text-carbon-textMuted">{error ?? t('engine.loading')}</p>
    </Card>
  )
}
