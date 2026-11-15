const REGION = /^([a-z]{2}|\d{3})$/i

/**
 * The locale dates and times are written in: the app's language with the
 * device's region, so English on a British phone writes 03/11 and 14:05 while
 * the words stay in the language picked in the app.
 */
export function dateLocale(lang: string, region: string | null): string {
  return region && REGION.test(region) ? `${lang}-${region.toUpperCase()}` : lang
}

/** The region of a language tag such as en-GB or zh-Hant-TW, or null where it names none. */
export function regionOf(tag: string | undefined): string | null {
  const region = tag?.split(/[-_]/).slice(1).find((part) => REGION.test(part))
  return region ? region.toUpperCase() : null
}
