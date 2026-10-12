// The page a new install opens on: what ArrowLoop has found on this machine
// and the three steps to the first sync.

import { useEffect, useState, type CSSProperties } from 'react'

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

const TONE: Record<StepState, string> = {
  done: 'bg-statusOkBg text-statusOk',
  next: 'bg-accent text-accentContrast',
  open: 'bg-carbon-surface2 text-carbon-textSub',
}

/** The number in front of a step. A finished step shows a tick, and only the next one wears the accent. */
function StepMark({ n, state }: { n: number; state: StepState }) {
  return (
    <span
      aria-hidden
      className={`glim-num flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-pill)] text-subline font-semibold [&_svg]:h-3.5 [&_svg]:w-3.5 ${TONE[state]}`}
    >
      {state === 'done' ? <IconCheck /> : n}
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
