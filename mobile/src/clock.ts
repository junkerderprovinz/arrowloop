/**
 * Formats a moment as an absolute date and time in the app's language. A
 * relative "5 minutes ago" would need each unit's plural forms, which Hermes'
 * Intl cannot supply, and it cannot express a time in the future such as the
 * next run.
 */
export function clock(iso: string, lang: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "-";
  try {
    return at.toLocaleString(lang, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    // An unknown language tag falls back to the default locale.
    return at.toLocaleString();
  }
}
