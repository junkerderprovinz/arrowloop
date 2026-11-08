import { QRCode } from '../../../components/QRCode'
import { PHRASE_WORDS } from '../../../lib/phraseWords'

/**
 * The twelve words in numbered tiles, the same wherever they appear: shown to
 * be read out, or filling as somebody types them. Beside the QR code the rows
 * stretch to the code's height, so both end flush.
 */
export function WordSlots({ words, unknown = [], label, code }: { words: string[]; unknown?: number[]; label?: string; code?: string }) {
  const bad = new Set(unknown)
  const grid = (
    <ol className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4 sm:grid-rows-3" aria-label={label} aria-hidden={label ? undefined : true}>
      {Array.from({ length: PHRASE_WORDS }, (_, i) => {
        const w = words[i]
        const tone =
          w === undefined
            ? 'ring-1 ring-inset ring-carbon-border text-carbon-textMuted'
            : bad.has(i)
              ? 'bg-statusFailBg text-statusFail'
              : 'bg-carbon-surface2 text-carbon-text'
        return (
          <li key={i} data-slot={i + 1} className={`flex min-w-0 items-center gap-2 rounded-control px-3 py-1.5 text-subline ${tone}`}>
            <span className={`glim-num w-[1.125rem] shrink-0 text-end text-meta${bad.has(i) ? '' : ' text-carbon-textMuted'}`}>{i + 1}</span>
            <span dir="ltr" className="truncate font-mono">
              {w ?? '·'}
            </span>
          </li>
        )
      })}
    </ol>
  )
  if (!code) return grid
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
      {grid}
      <div className="flex shrink-0 justify-center sm:items-start">
        <QRCode value={code} size={128} className="rounded-control" />
      </div>
    </div>
  )
}
