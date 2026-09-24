import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { subscribeRainbow } from '../lib/appearance'

// The app's own small layout pieces. The controls themselves are GlimStone's,
// copied unedited into lib/glimstone/.

/**
 * Re-renders when the rainbow changes. Its state lives on the document root
 * outside React, so anything that asks for a colour has to be woken.
 */
export function useRainbow(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeRainbow(() => setVersion((v) => v + 1)), [])
  return version
}

/** Cards stack on one shared 40px rhythm, room for each card's title badge. */
export function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-10">{children}</div>
}

/** Tabular figures, so a changing count does not jitter sideways. */
export function Num({ children }: { children: ReactNode }) {
  return <span className="glim-num">{children}</span>
}

/** A hairline separator, as much of a line as the design language allows. */
export function Rule() {
  return <div className="h-px w-full" style={{ background: 'var(--hairline)' }} />
}

/** A card's one-line state, with a dot that is lit while the thing is on. */
export function StateLine({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${on ? 'bg-statusOkSolid' : 'bg-carbon-textMuted'}`}
      />
      <span className="text-sm text-carbon-text">{children}</span>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-xs text-carbon-textMuted">{children}</p>
}
