// What only the desktop app has: the small window at the tray icon, the pause
// the tray keeps, and the tray's words. Mirrors internal/web/window.go.

import { useEffect } from 'react'

import type { Translate } from './i18n'

/** The tray's lines, in the language the interface shows. */
export type TrayWords = {
  open: string
  syncNow: string
  pause: string
  resume: string
  quit: string
  paused: string
  running: string
  done: string
}

/** The query the desktop app opens its tray window with. */
export function isActivityView(): boolean {
  return new URLSearchParams(window.location.search).get('view') === 'activity'
}

/** Whether this page runs in a desktop app window, which Wails serves from an origin of its own. */
export function inDesktopWindow(): boolean {
  return window.location.protocol === 'wails:' || window.location.hostname === 'wails.localhost'
}

/** The event the desktop app sends each run event as; runEvent in desktop/bridge.go. */
const RUN_EVENT = 'arrowloop:run'

type WailsHost = {
  _wails?: {
    dispatchWailsEvent?: (ev: { name: string; data: unknown }) => void
    invoke?: (message: string) => void
  }
}

const runListeners = new Set<(data: unknown) => void>()

let announced = false

/**
 * Tells Wails the page can take events. Wails holds every script for a window
 * until it hears this, which its own runtime would send. It can only be sent
 * once Wails has put `invoke` on the page, after the page itself has loaded.
 */
function announce(host: WailsHost) {
  if (announced) return
  announced = true
  const send = () => host._wails?.invoke?.('wails:runtime:ready')
  if (host._wails?.invoke) send()
  else window.addEventListener('wails:runtime-config-ready', send, { once: true })
}

/**
 * Follows the run events the desktop app sends into its windows. On Windows the
 * window's asset server hands a response over only once it is complete, so the
 * /api/events stream never arrives and the app sends each event this way
 * instead. Wails delivers them to the dispatcher set here; its own runtime,
 * which would set one, is not loaded.
 */
export function watchDesktop(onEvent: (data: unknown) => void): () => void {
  const host = window as unknown as WailsHost
  host._wails = host._wails ?? {}
  host._wails.dispatchWailsEvent = (ev) => {
    if (ev.name !== RUN_EVENT) return
    for (const listener of runListeners) listener(ev.data)
  }
  announce(host)
  runListeners.add(onEvent)
  return () => {
    runListeners.delete(onEvent)
  }
}

export function trayWords(t: Translate): TrayWords {
  return {
    open: t('tray.open'),
    syncNow: t('tray.syncNow'),
    pause: t('tray.pause'),
    resume: t('tray.resume'),
    quit: t('tray.quit'),
    paused: t('tray.paused'),
    running: t('tray.running'),
    done: t('tray.done'),
  }
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(res.statusText)
  return (await res.json()) as T
}

export const desk = {
  /** Whether the tray holds every automatic run. */
  paused: async (): Promise<boolean> => (await send<{ paused?: boolean }>('/api/window', 'GET')).paused === true,

  setPaused: async (paused: boolean): Promise<boolean> =>
    (await send<{ paused?: boolean }>('/api/window/paused', 'PUT', { paused })).paused === true,

  words: (words: TrayWords) => send<TrayWords>('/api/window/words', 'PUT', words),

  /** Brings the main window forward and closes the tray window. */
  open: () => send<{ opened: boolean }>('/api/window/open', 'POST'),
}

/**
 * Hands the tray its words whenever the language changes, so the menu and the
 * tooltip speak it too. `active` is false where there is no window.
 */
export function useTrayWords(active: boolean, t: Translate): void {
  useEffect(() => {
    if (!active) return
    // A failure leaves the tray in its last language, which is no reason to
    // bother anybody.
    void desk.words(trayWords(t)).catch(() => {})
  }, [active, t])
}
