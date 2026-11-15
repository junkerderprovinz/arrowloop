// Every name GlimStone still ships but has deprecated, the one list the
// warnings and the drift check read. A name goes in the first major release
// after it is deprecated, and not before it has been deprecated through two
// minor releases ("Deprecating and removing" in the design language).

export interface Deprecation {
  /** The release that deprecated it. */
  since: string;
  /** The major release that removes it. */
  removal: string;
  /** What to use instead, as a sentence. */
  use: string;
  /** A regular expression that finds a use in an app's source, where the name alone would not. */
  find?: string;
}

export const DEPRECATED: Record<string, Deprecation> = {
  "Badge shape": {
    since: "4.4.0",
    removal: "5.0.0",
    use: 'Use `form`. Only shape="circle" has an effect, and form="circle" draws the same badge.',
    find: String.raw`<Badge\b[^>]*?\s:?shape=`,
  },
  BadgeShape: { since: "4.4.0", removal: "5.0.0", use: "Use `BadgeForm`." },
  AboutCard: {
    since: "3.3.0",
    removal: "5.0.0",
    use: 'Use `InfoTile`, which adds the version rows\' sub-lines, the other components, "Check for updates" and the bug report.',
  },
  DropdownListbox: { since: "3.6.0", removal: "5.0.0", use: "Use Select, which keeps focus on its trigger and adds typeahead." },
  "ToastViewport enter": {
    since: "4.5.0",
    removal: "5.0.0",
    use: "Listen to `mouse-enter`, the name of React's handler.",
    find: String.raw`<ToastViewport\b[^>]*?\s(?:@|v-on:)enter=`,
  },
  "ToastViewport leave": {
    since: "4.5.0",
    removal: "5.0.0",
    use: "Listen to `mouse-leave`, the name of React's handler.",
    find: String.raw`<ToastViewport\b[^>]*?\s(?:@|v-on:)leave=`,
  },
  "ToastViewport focusin": {
    since: "4.5.0",
    removal: "5.0.0",
    use: "Listen to `focus`, the name of React's handler.",
    find: String.raw`<ToastViewport\b[^>]*?\s(?:@|v-on:)focusin=`,
  },
  "ToastViewport focusout": {
    since: "4.5.0",
    removal: "5.0.0",
    use: "Listen to `blur`, the name of React's handler.",
    find: String.raw`<ToastViewport\b[^>]*?\s(?:@|v-on:)focusout=`,
  },
  "--ink-mix": {
    since: "4.5.0",
    removal: "5.0.0",
    use: "Read `--accent-ink`, which moves the accent onto the theme's OKLab ink step. The steps themselves are `--ink-l-light` and `--ink-l-dark`.",
    find: String.raw`var\(--ink-mix\)`,
  },
  "GlimTheme inkMix": {
    since: "4.5.0",
    removal: "5.0.0",
    use: "Use `inkLightness`, the OKLab step the accent's ink moves to: 0.52 on a light theme, 0.74 on a dark one.",
    find: String.raw`\binkMix\b`,
  },
  "GlimTheme focusRing argument": {
    since: "4.5.0",
    removal: "5.0.0",
    use: "Drop the argument. `focusRing` is a getter on `GlimDerived` that returns the accent ink.",
    find: String.raw`\bfocusRing\s*:`,
  },
};

const warned = new Set<string>();

/** The sentence a deprecated name is reported with. */
export function deprecationNote(name: string): string {
  const d = DEPRECATED[name]!;
  return `${name} is deprecated since GlimStone ${d.since} and goes in ${d.removal}. ${d.use}`;
}

/** Warns on the console the first time a page uses a deprecated name. */
export function warnDeprecated(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(deprecationNote(name));
}
