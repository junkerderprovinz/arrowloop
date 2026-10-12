import { useCallback, useEffect, useRef, useState } from 'react'

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

/**
 * The engine settings the General, Sync and Safety tabs show, saved as they
 * change. A save is quiet; a refusal says so in a toast, since the field that
 * caused it may be far up a long page. Each tab asks once and hands the result
 * to all its cards, since a save sends the whole draft and a second draft
 * would undo the first one's changes.
 */
export function useEngineSettings() {
  const { t } = useT()
  const push = useToast()
  const [loaded, setLoaded] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .settings()
      .then((got) => {
        setLoaded(got)
        setDraft(got)
        followSettings(got)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  // A ref, because the timer fires long after the render that scheduled it and
  // would otherwise send a stale draft.
  const latest = useRef<Settings>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Leaving the tab unmounts it, and a change still waiting to settle is sent
  // then rather than lost. Nothing is left on screen to take the answer.
  useEffect(
    () => () => {
      if (!timer.current) return
      clearTimeout(timer.current)
      void api.saveSettings(latest.current).catch(() => {})
    },
    [],
  )

  const commit = useCallback(async () => {
    try {
      // The whole draft rather than a diff; the endpoint merges. Only `loaded`
      // takes the answer: replacing the draft would overwrite a box somebody
      // is still typing in.
      const saved = await api.saveSettings(latest.current)
      setLoaded(saved)
      followSettings(saved)
    } catch (e) {
      push(errorText(t, e), 'fail')
    }
  }, [push, t])

  const patch = useCallback(
    (next: Partial<Settings>) => {
      setDraft((prev) => {
        const merged = { ...prev, ...next }
        latest.current = merged
        return merged
      })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        void commit()
      }, SETTLE_MS)
    },
    [commit],
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

/** Stands in for a tab's cards until the settings have been read. */
export function Reading({ title, error, hueIndex = 0 }: { title: string; error: string | null; hueIndex?: number }) {
  const { t } = useT()
  return (
    <Card title={title} hueIndex={hueIndex}>
      <p className="text-subline text-carbon-textMuted">{error ?? t('engine.loading')}</p>
    </Card>
  )
}
