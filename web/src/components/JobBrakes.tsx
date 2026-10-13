import { useEffect, useRef, useState } from 'react'

import { NumberField } from './Field'
import { InheritButton, InheritedRow } from './Inherited'
import { Card } from '../lib/glimstone/Card'
import type { RawJob } from '../lib/api'
import { inForce, inheritPatch, owns } from '../lib/follows'
import { useT } from '../lib/i18n'
import type { useJobConfig } from '../pages/Editor'

/** How long a typed brake value waits before it is saved, as on the settings page. */
const SETTLE_MS = 700

type Brake = 'brakePercent' | 'changePercent'

const BRAKES: { setting: Brake; label: 'engine.brakePercent' | 'engine.changePercent'; hint: 'engine.brakePercentHint' | 'engine.changePercentHint' }[] = [
  { setting: 'brakePercent', label: 'engine.brakePercent', hint: 'engine.brakePercentHint' },
  { setting: 'changePercent', label: 'engine.changePercent', hint: 'engine.changePercentHint' },
]

/**
 * The brakes that hold a run of this job, each the global value, locked, or
 * one of the job's own. They hold whether or not the anomaly notes are on.
 * They are written through the page's own copy of the configuration, so
 * editing the job afterwards keeps them.
 */
export function BrakesCard({
  job,
  config,
  hueIndex,
}: {
  job: string
  config: ReturnType<typeof useJobConfig>
  hueIndex: number
}) {
  const { t } = useT()
  const saved = config.jobs?.find((j) => j.name === job) ?? {}
  // What is typed shows at once; the file gets it once the typing settles,
  // since every save makes the engine reload.
  const [typed, setTyped] = useState<Partial<Record<Brake, number>>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<(() => void) | null>(null)

  const write = (change: Partial<RawJob>) => void config.amend(job, (raw) => ({ ...raw, ...change }))

  // Leaving the page sends a value still waiting to settle.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      pending.current?.()
    },
    [],
  )

  const type = (setting: Brake, value: number) => {
    const next = { ...typed, [setting]: value }
    setTyped(next)
    if (timer.current) clearTimeout(timer.current)
    pending.current = () => write(next)
    timer.current = setTimeout(() => {
      timer.current = null
      pending.current = null
      write(next)
      setTyped({})
    }, SETTLE_MS)
  }

  return (
    <div data-new="job-brakes">
      <Card title={t('job.brakes')} hint={t('job.brakesHint')} hueIndex={hueIndex}>
        <div data-new="own-values" className="flex flex-col gap-4">
          {BRAKES.map(({ setting, label, hint }) => {
            const own = owns(saved, setting)
            const value = typed[setting] ?? (own ? saved[setting] : inForce(config.defaults, setting)[setting]) ?? 0
            return (
              <InheritedRow
                key={setting}
                label={t(label)}
                hint={t(hint)}
                own={own}
                action={
                  <InheritButton
                    setting={setting}
                    own={own}
                    defaults={config.defaults}
                    onOverride={() => write(inForce(config.defaults, setting) as Partial<RawJob>)}
                    onInherit={() => write(inheritPatch(setting) as Partial<RawJob>)}
                  />
                }
              >
                <NumberField value={value} min={0} max={100} label={t(label)} onChange={(v) => type(setting, v)} />
              </InheritedRow>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
