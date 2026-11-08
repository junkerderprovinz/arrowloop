import type { CSSProperties, ReactNode } from 'react'

import { hueVars } from '../lib/appearance'
import { Badge } from '../lib/glimstone/Badge'
import { InfoBubble } from '../lib/glimstone/InfoBubble'

/**
 * A numbered step, as BombVault's pairing page draws them: the number and the
 * title are two heading badges on the card's top edge, and the card takes the
 * hue of its position.
 */
export function StepCard({
  n,
  title,
  hint,
  hueIndex,
  children,
}: {
  n: number
  title: string
  hint?: string
  hueIndex?: number
  children: ReactNode
}) {
  const hued = hueIndex !== undefined
  return (
    <div
      className={`glim-notch-card relative rounded-card bg-carbon-surface p-4 pt-7${hued ? ' glim-hue' : ''}`}
      style={hued ? (hueVars(hueIndex) as CSSProperties) : undefined}
    >
      {/* Both badges sit in the flow of one positioned heading, so the pair
          stays centred on the edge when a long title wraps. */}
      <h2 className="absolute top-0 z-10 flex max-w-[calc(100%-3.25rem)] -translate-y-1/2 items-center gap-1.5">
        <Badge tone="heading" size="heading" inFlow hueIndex={hueIndex} className="shrink-0">
          {/* Letter spacing follows the last character and would push a lone digit off centre. */}
          <span className="glim-num tracking-normal">{n}</span>
        </Badge>
        <Badge tone="heading" size="heading" inFlow wrap hueIndex={hueIndex} className="min-w-0">
          {title}
          {hint && <InfoBubble tip={hint} onAccent />}
        </Badge>
      </h2>
      <div className="flex flex-col gap-2 text-body text-carbon-textMuted">{children}</div>
    </div>
  )
}
