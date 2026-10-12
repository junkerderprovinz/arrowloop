// Every job as a ring of ten parts, one for each successful run its habits
// were learned from, as BombVault draws its watched items. A ring still
// filling takes the accent and a full one turns green, so the jobs that are
// done stand out.
import { useState, type CSSProperties } from 'react'

import { DirectionGlyph } from './Direction'
import { LEARN_AFTER, type JobLearning } from '../lib/anomalies'
import { useTipBubble } from '../lib/glimstone/useTipBubble'
import { useT } from '../lib/i18n'
import { useLive } from '../lib/live'

const PARTS = 10
const RADIUS = 23
const ROUND = 2 * Math.PI * RADIUS
const PART = ROUND / PARTS
const GAP = 3

function Ring({ learning, onOpen }: { learning: JobLearning; onOpen: () => void }) {
  const { t } = useT()
  const { jobs } = useLive()
  const lit = Math.min(PARTS, Math.floor((learning.runs * PARTS) / LEARN_AFTER))
  // Only the parts a run added while the page was open grow in.
  const [grown, setGrown] = useState({ from: lit, to: lit })
  if (grown.to !== lit) setGrown({ from: grown.to, to: lit })

  const done = learning.runs >= LEARN_AFTER
  const say = [
    learning.job,
    done ? t('anomaly.learn.done') : t('anomaly.learn.progress', { count: Math.min(learning.runs, LEARN_AFTER), total: LEARN_AFTER }),
  ].join(' · ')
  const tooltip = useTipBubble(say)
  const direction = jobs.find((j) => j.name === learning.job)?.direction

  return (
    <li className="flex min-w-0">
      <button
        ref={tooltip.ref}
        type="button"
        aria-label={say}
        aria-describedby={tooltip.describedBy}
        {...tooltip.handlers}
        onClick={onOpen}
        className="flex min-h-11 min-w-0 flex-1 flex-col items-center gap-1.5 rounded-control px-1 pb-2 pt-2.5 text-carbon-text hover:bg-carbon-hover"
      >
        <span className="relative flex h-[54px] w-[54px] items-center justify-center text-carbon-textSub [&>svg:last-child]:h-5 [&>svg:last-child]:w-5">
          {/* A circle's stroke starts at three o'clock; the turn puts the first
              part at the top. */}
          <svg viewBox="0 0 54 54" aria-hidden="true" className="absolute inset-0 h-full w-full -rotate-90 fill-none stroke-[3.5]">
            {Array.from({ length: PARTS }, (_, i) => {
              const grows = i >= grown.from && i < grown.to
              return (
                <circle
                  key={i}
                  data-lit={i < lit}
                  cx="27"
                  cy="27"
                  r={RADIUS}
                  strokeDasharray={`${(PART - GAP).toFixed(2)} ${ROUND.toFixed(2)}`}
                  strokeDashoffset={(-(i * PART + GAP / 2)).toFixed(2)}
                  style={grows ? ({ '--ring-i': i - grown.from } as CSSProperties) : undefined}
                  className={`${i < lit ? (done ? 'stroke-statusOkSolid' : 'stroke-accent') : 'stroke-carbon-surface3'}${
                    grows ? ' glim-ring-grow' : ''
                  }`}
                />
              )
            })}
          </svg>
          {direction && <DirectionGlyph direction={direction} />}
        </span>
        <span className="max-w-full truncate text-meta font-medium" title={learning.job}>
          {learning.job}
        </span>
      </button>
      {tooltip.bubble}
    </li>
  )
}

export function LearningRings({ learning, onOpen }: { learning: JobLearning[]; onOpen: (job: string) => void }) {
  const { t } = useT()
  return (
    <>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-1 sm:grid-cols-[repeat(auto-fill,minmax(92px,1fr))]">
        {learning.map((l) => (
          <Ring key={l.job} learning={l} onOpen={() => onOpen(l.job)} />
        ))}
      </ul>
      <p className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-meta text-carbon-textMuted">
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden="true" className="h-2.5 w-2.5 rounded-full shadow-[inset_0_0_0_2.5px_var(--accent)]" />
          {t('anomaly.learn.learning')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden="true" className="h-2.5 w-2.5 rounded-full shadow-[inset_0_0_0_2.5px_var(--status-ok-solid)]" />
          {t('anomaly.learn.done')}
        </span>
      </p>
    </>
  )
}
