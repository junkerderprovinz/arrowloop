import { Fragment, type CSSProperties, type ReactNode } from 'react'

import { StepCard } from '../../../components/StepCard'
import { useT } from '../../../lib/i18n'
import { useSceneStops } from '../../../lib/sceneStops'
import { ScenePointer } from '../../welcomeArt'
import { STEP_STOPS, StepPicture } from './pairingArt'

/** A bold copy of `what` wherever the text says {token}. */
export function emphasize(text: string, token: string, what: string): ReactNode {
  const parts = text.split(`{${token}}`)
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && <strong className="font-semibold text-carbon-text">{what}</strong>}
    </Fragment>
  ))
}

/**
 * Three numbered cards open the tile before any button does anything: make a
 * phrase on the first instance, enter it on every other, approve. Their
 * pictures play one scene, and one pointer walks through all three.
 */
export function PairingSteps({ hues }: { hues: [number, number, number] }) {
  const { t } = useT()
  const steps = [
    { title: t('pairing.step1Title'), body: t('pairing.step1Body') },
    { title: t('pairing.step2Title'), body: emphasize(t('pairing.step2Body'), 'button', t('pairing.enter')) },
    { title: t('pairing.step3Title'), body: t('pairing.step3Body') },
  ]
  const { grid, stops, stepMin } = useSceneStops(STEP_STOPS, steps.map((s) => s.title).join('\n'))
  return (
    <section aria-label={t('pairing.howTitle')} data-new="pairing">
      {/* The number badges straddle the cards' top edge, so stacked cards keep
          more room between them than a card gap. Side by side, each takes the
          room above the page's first card. On a wider screen a title keeps to
          one line, and a card that would cut it short moves to the next row
          instead. */}
      <div
        ref={grid}
        style={{ '--step-min': `${stepMin}px` } as CSSProperties}
        className="relative grid grid-cols-1 gap-10 md:grid-cols-[repeat(auto-fit,minmax(min(100%,max(var(--step-min),30%)),1fr))] md:gap-6 md:[&_h2>*]:whitespace-nowrap md:[&>.glim-notch-card]:mt-[11px]"
      >
        {steps.map((s, i) => (
          <StepCard key={i} n={i + 1} title={s.title} hueIndex={hues[i]}>
            {/* On a phone the picture moves beside the words, so three cards do not take three screens. */}
            <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-4 md:flex md:flex-col md:items-stretch md:gap-3">
              <div data-step-frame className="al-scene-frame mx-auto max-w-[280px]">
                <StepPicture step={(i + 1) as 1 | 2 | 3} t={t} />
              </div>
              <p className="[overflow-wrap:anywhere] hyphens-auto">{s.body}</p>
            </div>
          </StepCard>
        ))}
        <ScenePointer style={stops} />
      </div>
    </section>
  )
}
