/**
 * The hour cycle a device's clock setting asks for, as options for Intl.
 * Android keeps 24-hour time apart from the language, so English on a 24-hour
 * phone reads 14:40. Null, for a device that does not say, leaves the
 * language its own habit. hourCycle rather than hour12, which some engines
 * turn into h24 and so show midnight as 24:05.
 */
export function hourCycle(uses24: boolean | null): Pick<Intl.DateTimeFormatOptions, 'hourCycle'> {
  if (uses24 === null) return {}
  return { hourCycle: uses24 ? 'h23' : 'h12' }
}
