/**
 * Which word a moment's day takes beside its time, by the web's dayTime rule:
 * today and yesterday by name, the weekday within the week, digits beyond.
 */
export function dayWord(at: Date, now: Date): "today" | "yesterday" | "weekday" | "date" {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return days > 1 && days < 7 ? "weekday" : "date";
}
