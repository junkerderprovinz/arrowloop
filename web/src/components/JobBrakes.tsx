import { useEffect, useRef, useState } from 'react'

import { Field, NumberField } from './Field'
import { ToggleRow } from './ToggleRow'
import { Card } from '../lib/glimstone/Card'
import { globalBrakes, ownBrakes, type Brakes } from '../lib/anomalies'
import { useT } from '../lib/i18n'
import type { useJobConfig } from '../pages/Editor'

/** How long a typed brake value waits before it is saved, as on the settings page. */
const SETTLE_MS = 700

type Own = Pick<Brakes, 'brakePercent' | 'changePercent'>

/**
 * The brakes that hold a run of this job: the global ones it follows, or its
 * own two values. They hold whether or not the anomaly notes are on. They are
 * written through the page's own copy of the configuration, so editing the
 * job afterwards keeps them.
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
  const global = globalBrakes(config.defaults)
  const saved = ownBrakes(
    config.jobs?.find((j) => j.name === job),
    global,
  )
  // What is typed shows at once; the file gets it once the typing settles,
  // since every save makes the engine reload.
  const [typed, setTyped] = useState<Own | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const own = typed ?? saved

  const write = (next: Own | null) =>
    void config.amend(job, (raw) => {
      const { brakePercent: _b, changePercent: _c, ...rest } = raw
      return next ? { ...rest, ...next } : rest
    })

  // Leaving the page sends a value still waiting to settle.
  const pending = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      pending.current?.()
    },
    [],
  )

  const type = (change: Partial<Own>) => {
    const next = { ...(own ?? global), ...change }
    setTyped(next)
    if (timer.current) clearTimeout(timer.current)
    pending.current = () => write(next)
    timer.current = setTimeout(() => {
      timer.current = null
      pending.current = null
      write(next)
      setTyped(null)
    }, SETTLE_MS)
  }

  return (
    <Card title={t('job.brakes')} hint={t('job.brakesHint')} hueIndex={hueIndex}>
      {!own && (
        <p className="text-subline text-carbon-textSub">
          {t('anomaly.follows', { delete: global.brakePercent, change: global.changePercent, floor: global.brakeFloor })}
        </p>
      )}
      <ToggleRow
        label={t('anomaly.ownBrakes')}
        hint={t('anomaly.ownBrakesHint')}
        checked={own !== null}
        disabled={config.jobs === null || config.busy}
        onChange={(on) => write(on ? { brakePercent: global.brakePercent, changePercent: global.changePercent } : null)}
      />
      {own && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('engine.brakePercent')} hint={t('engine.brakePercentHint')}>
            <NumberField
              value={own.brakePercent}
              min={0}
              max={100}
              label={t('engine.brakePercent')}
              onChange={(v) => type({ brakePercent: v })}
            />
          </Field>
          <Field label={t('engine.changePercent')} hint={t('engine.changePercentHint')}>
            <NumberField
              value={own.changePercent}
              min={0}
              max={100}
              label={t('engine.changePercent')}
              onChange={(v) => type({ changePercent: v })}
            />
          </Field>
        </div>
      )}
    </Card>
  )
}
