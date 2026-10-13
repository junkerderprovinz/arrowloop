import { sayFailure, type Failure } from '../lib/failure'
import { useT } from '../lib/i18n'

/**
 * Why a run failed: the sentence in the reader's language, and under it the
 * engine's own words where they still tell something.
 */
export function FailureText({ raw, failure, className = '' }: { raw: string; failure?: Failure; className?: string }) {
  const { t, lang } = useT()
  const { said, engine } = sayFailure(raw, failure, t, lang)
  return (
    <div className={`flex flex-col gap-1 text-subline ${className}`}>
      <p className="break-words">{said}</p>
      {engine && (
        <p dir="ltr" className="text-start font-mono text-carbon-textMuted [overflow-wrap:anywhere]">
          {engine}
        </p>
      )}
    </div>
  )
}
