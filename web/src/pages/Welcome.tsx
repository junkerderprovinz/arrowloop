// The page a new install opens on: what ArrowLoop has found on this machine
// and the three steps to the first sync.

import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { IconCheck, IconSearch } from '../components/glyphs'
import { LOGO_GOLD, LogoMark } from '../components/LogoMark'
import { api } from '../lib/api'
import { hueVars } from '../lib/appearance'
import { FIRST_STEPS, foundLine, stepStates, type FirstStep, type Found, type StepState } from '../lib/firstSteps'
import { Button } from '../lib/glimstone/Button'
import { useT, type TranslationKey } from '../lib/i18n'
import { Link, navigate } from '../lib/router'
import { openSetting } from './settings/SettingsSearch'

const STEP: Record<FirstStep, { title: TranslationKey; sub: TranslationKey; to?: string }> = {
  target: { title: 'welcome.target', sub: 'welcome.targetSub', to: '/targets' },
  job: { title: 'welcome.job', sub: 'welcome.jobSub', to: '/jobs' },
  preview: { title: 'welcome.preview', sub: 'welcome.previewSub' },
}

/**
 * The number in front of a step, in the accent for every step, and a tick once
 * the step is done. A step that is done while the page is open runs a ring
 * round its mark first (`.al-step-ring` in index.css).
 */
function StepMark({ n, state }: { n: number; state: StepState }) {
  const was = useRef(state)
  const [fresh, setFresh] = useState(false)
  useEffect(() => {
    if (state === 'done' && was.current !== 'done') setFresh(true)
    was.current = state
  }, [state])
  return (
    <span
      aria-hidden
      data-state={state}
      style={{ '--step': n - 1 } as CSSProperties}
      className={`al-step-mark glim-num relative grid h-7 w-7 flex-none place-items-center rounded-[var(--radius-pill)] bg-accent text-subline font-semibold text-accentContrast [&_svg]:h-3.5 [&_svg]:w-3.5${fresh ? ' al-step-fresh' : ''}`}
    >
      <span className="al-step-ring" />
      <span className="al-step-face al-step-number">{n}</span>
      <span className="al-step-face al-step-tick">
        <IconCheck />
      </span>
    </span>
  )
}

/** What the machine already holds, read once; a question that fails names nothing. */
function useFound(): { found: Found; hasTarget: boolean } {
  const [found, setFound] = useState<Found>({ targets: 0, drives: 0 })
  const [marked, setMarked] = useState(0)
  useEffect(() => {
    let live = true
    void Promise.allSettled([api.remotes(), api.volumeCandidates(), api.volumes()]).then(([r, c, v]) => {
      if (!live) return
      setFound({
        targets: r.status === 'fulfilled' ? r.value.remotes.length : 0,
        drives: c.status === 'fulfilled' ? c.value.candidates.length : 0,
      })
      setMarked(v.status === 'fulfilled' ? v.value.volumes.length : 0)
    })
    return () => {
      live = false
    }
  }, [])
  return { found, hasTarget: found.targets > 0 || marked > 0 }
}

/**
 * The first start, while no job exists. The app sends `/` here until then, and
 * leads away from here once there is one.
 */
export function Welcome({ fresh }: { fresh: boolean | null }) {
  const { t } = useT()
  const { found, hasTarget } = useFound()
  const states = stepStates(hasTarget)
  const line = foundLine(found, t)

  useEffect(() => {
    if (fresh === false) navigate('/jobs', { replace: true })
  }, [fresh])
  if (!fresh) return null

  return (
    <div className="mx-auto mt-[6vh] flex w-full max-w-[47.5rem] flex-col items-center gap-[22px] pb-6 text-center">
      <LogoMark size={120} style={{ color: LOGO_GOLD }} />
      <h1 className="text-status font-semibold leading-tight text-carbon-text">{t('welcome.title')}</h1>
      <p className="text-body text-carbon-textSub">{t('welcome.lead')}</p>
      {line && (
        <p data-testid="welcome-found" className="flex items-center gap-2 text-subline text-carbon-textSub">
          <span className="flex flex-none text-accentText [&_svg]:h-4 [&_svg]:w-4">
            <IconSearch />
          </span>
          <span>{line}</span>
        </p>
      )}
      <ol className="grid w-full gap-4 text-start md:grid-cols-3">
        {FIRST_STEPS.map((step, i) => {
          const { title, sub, to } = STEP[step]
          const state = states[step]
          const name = (
            <>
              {t(title)}
              {state === 'done' && <span className="sr-only">{` (${t('welcome.done')})`}</span>}
            </>
          )
          return (
            <li
              key={step}
              data-step={step}
              data-state={state}
              aria-current={state === 'next' ? 'step' : undefined}
              style={hueVars(i) as CSSProperties}
              className="glim-hue flex gap-3 rounded-card bg-carbon-surface p-[18px]"
            >
              <StepMark n={i + 1} state={state} />
              <div className="flex min-w-0 flex-col gap-0.5">
                {to && state !== 'done' ? (
                  <Link to={to} className="text-body font-semibold text-carbon-text hover:underline">
                    {name}
                  </Link>
                ) : (
                  <span className="text-body font-semibold text-carbon-text">{name}</span>
                )}
                <span className="text-subline text-carbon-textMuted">{t(sub)}</span>
              </div>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          label={t('welcome.restore')}
          labelKey="welcome.restore"
          className="glim-btn-key"
          onClick={() => openSetting('general', { card: t('backup.title') })}
        />
        <Button
          label={t('welcome.start')}
          labelKey="welcome.start"
          tone="accent"
          className="glim-btn-key"
          onClick={() => navigate('/jobs')}
        />
      </div>
      <p className="text-body text-carbon-textSub">{t('welcome.before')}</p>
    </div>
  )
}
