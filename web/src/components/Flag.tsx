/**
 * A country flag, drawn from the flag-icons sprite.
 *
 * Not the regional-indicator emoji, and the difference is the whole reason this
 * file exists. Those two codepoints are what the design language calls the
 * plain-`<select>` default: an `<option>` can hold nothing but text, so an emoji
 * is the only flag a native list can carry. Windows then renders that sequence
 * as a small two-letter tag rather than a flag, which is Microsoft's own
 * long-standing policy in its emoji font and true of every Windows program, not
 * a bug here. Reported exactly that way ("die flaggen der sprachen werden nicht
 * angezeigt"), and on the machine this runs on it is what everybody sees.
 *
 * The design language's own follow-up is that once a surface has stopped using
 * a native select, the constraint that produced the emoji rule is gone: a
 * listbox is ordinary page DOM, so it can carry the same artwork the rest of
 * the app already uses. This app's language list stopped using a native select
 * in the same change, so it takes that route rather than the webfont one, and
 * it matches BombVault, which took it first.
 *
 * `lib/flagEmoji.ts` and `lib/selectScroll.ts` stay in place and now have no
 * caller here. They are GlimStone's own files, copied rather than written, and
 * both answer a question this app has stopped asking: what a native `<option>`
 * can hold, and how to make a native select's list scroll. Deleting a copy
 * means the next time the folder is refreshed from the language, the missing
 * file reads as an omission rather than a decision. The bundler drops them.
 */
export function Flag({ code }: { code: string }) {
  return (
    <span
      className={`fi fi-${code}`}
      aria-hidden
      style={{ width: '1.25em', height: '1em', display: 'inline-block', flexShrink: 0 }}
    />
  )
}
