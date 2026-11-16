import { capitalized } from './capitalized'

/**
 * A moment as its day and time, spelled out where it is near: "Today, 03:51",
 * "Yesterday, 03:48", "Sunday, 04:10", and an older one with its digits. The
 * joining sentence comes from the table, since German adds "Uhr" and English
 * adds nothing.
 */
export function dayTime(
  when: string | Date,
  locale: string,
  join: (parts: { day: string; time: string }) => string,
  now: Date = new Date(),
): string {
  const at = new Date(when)
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000)
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at)

  let day: string
  if (days === 0 || days === 1) {
    day = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-days, 'day')
  } else if (days > 1 && days < 7) {
    day = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(at)
  } else {
    day = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(at)
  }
  return join({ day: capitalized(day, locale), time })
}
