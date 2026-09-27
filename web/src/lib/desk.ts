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
