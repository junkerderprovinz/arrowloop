import { Num } from './Shell'
import { since } from '../lib/since'
import { useT } from '../lib/i18n'

/** A time as "2 days ago" in the reader's language, with the exact time on hover. */
export function Since({ when }: { when: string }) {
  const { lang } = useT()
  const { count, unit } = since(when)
  const parts = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).formatToParts(-count, unit)
  return (
    <span title={new Date(when).toLocaleString(lang)}>
      {parts.map((part, i) => (part.type === 'integer' ? <Num key={i}>{part.value}</Num> : part.value))}
    </span>
  )
}
