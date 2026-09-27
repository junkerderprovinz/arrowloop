import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { ToastViewport } from './glimstone/Toast'
import {
  NO_ENGAGEMENT,
  addToast,
  applyEngagement,
  pauseToast,
  removeToast,
  resumeToast,
  TOAST_DURATION_MS,
  type ToastEngagement,
  type ToastEngagementKind,
  type ToastEntry,
  type ToastSeverity,
} from './glimstone/toastEngine'
import { useT } from './i18n'

// The live half of GlimStone's toasts: the timers, the portal and the hover
// and focus bookkeeping. The rules themselves are plain functions in
// toastEngine.ts.
//
// The viewport is portalled to <body>, because a `position: fixed` element
// under a transformed ancestor such as .glim-page-enter is clipped to it.

type Push = (message: string, severity?: ToastSeverity) => void

// A no-op outside the provider, so a component can ask for it in a test.
const ToastContext = createContext<Push>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useT()
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const engagement = useRef(new Map<string, ToastEngagement>())
  const nextId = useRef(0)

  const clearTimer = useCallback((id: string) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
  }, [])

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id)
      engagement.current.delete(id)
      setToasts((list) => removeToast(list, id))
    },
    [clearTimer],
  )

  const schedule = useCallback(
    (id: string, ms: number) => {
      clearTimer(id)
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ms),
      )
    },
    [clearTimer, dismiss],
  )

  const push = useCallback<Push>(
    (message, severity = 'success') => {
      const id = `toast-${++nextId.current}`
      setToasts((list) => {
        const next = addToast(list, { id, message, severity }, Date.now())
        // A toast the cap pushed out still has its timer.
        for (const dropped of list) {
          if (!next.some((kept) => kept.id === dropped.id)) {
            clearTimer(dropped.id)
            engagement.current.delete(dropped.id)
          }
        }
        return next
      })
      schedule(id, TOAST_DURATION_MS)
    },
    [clearTimer, schedule],
  )

  const setEngagement = useCallback(
    (id: string, kind: ToastEngagementKind, active: boolean) => {
      const { next, engaged } = applyEngagement(engagement.current.get(id) ?? NO_ENGAGEMENT, kind, active)
      if (engaged) engagement.current.set(id, next)
      else engagement.current.delete(id)
      if (active) {
        clearTimer(id)
        setToasts((list) => pauseToast(list, id, Date.now()))
      } else if (!engaged) {
        // The clock restarts from what the pause left, not from the start.
        setToasts((list) => {
          const resumed = resumeToast(list, id, Date.now())
          const entry = resumed.find((toast) => toast.id === id)
          if (entry?.expiresAt != null) schedule(id, Math.max(0, entry.expiresAt - Date.now()))
          return resumed
        })
      }
    },
    [clearTimer, schedule],
  )

  useEffect(() => {
    const live = timers.current
    return () => {
      live.forEach((handle) => clearTimeout(handle))
      live.clear()
    }
  }, [])

  const handlers = useMemo(
    () => ({
      onMouseEnter: (id: string) => setEngagement(id, 'hover', true),
      onMouseLeave: (id: string) => setEngagement(id, 'hover', false),
      onFocus: (id: string) => setEngagement(id, 'focus', true),
      onBlur: (id: string) => setEngagement(id, 'focus', false),
    }),
    [setEngagement],
  )

  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <ToastViewport toasts={toasts} dismissLabel={t('common.close')} onDismiss={dismiss} {...handlers} />,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

/** Queues a toast in the corner of the window. */
export function useToast(): Push {
  return useContext(ToastContext)
}
