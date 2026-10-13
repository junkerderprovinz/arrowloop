/**
 * Wraps a question to the engine so that it is out at most once at a time and
 * goes out at most once per `gap` milliseconds. Calls made in between are
 * answered by one more question once the gap has passed, so the last change
 * is never missed and a burst of events costs one request.
 */
export function coalesce(ask: () => Promise<unknown>, gap: number): { (): void; cancel: () => void } {
  let out = false
  let again = false
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false

  const trigger = () => {
    if (cancelled) return
    if (out || timer !== undefined) {
      again = true
      return
    }
    const wait = last + gap - Date.now()
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = undefined
        trigger()
      }, wait)
      return
    }
    out = true
    again = false
    last = Date.now()
    void ask()
      .catch(() => undefined)
      .finally(() => {
        out = false
        if (again) trigger()
      })
  }
  trigger.cancel = () => {
    cancelled = true
    clearTimeout(timer)
  }
  return trigger
}
