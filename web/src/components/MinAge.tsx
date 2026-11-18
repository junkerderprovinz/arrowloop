import { useState } from 'react'

import { NumberField } from './Field'
import { HUE_OFFSET, Selector } from './Selector'
import { useT } from '../lib/i18n'
import { FIRST_CUSTOM, MAX_MIN_AGE, MIN_AGE_PRESETS, minAgeChoice, minAgeDays, type MinAgeChoice } from '../lib/minAge.data'

/**
 * How old a file has to be before a one-way job sends it: off, a preset, or a
 * number of days typed beside the segments.
 */
export function MinAge({ value, onChange }: { value?: number; onChange: (days: number | undefined) => void }) {
  const { t } = useT()
  const [custom, setCustom] = useState(() => minAgeChoice(value, false) === 'custom')
  const choice = minAgeChoice(value, custom)
  const options: { value: MinAgeChoice; label: string }[] = [
    { value: 'off', label: t('edit.minAge.off') },
    ...MIN_AGE_PRESETS.map((days) => ({ value: String(days) as MinAgeChoice, label: t('edit.minAge.days', { days }) })),
    { value: 'custom', label: t('edit.minAge.custom') },
  ]

  return (
    <span className="flex max-w-full flex-wrap items-center justify-end gap-2">
      <Selector<MinAgeChoice>
        scale="small"
        low
        hug
        label={t('edit.minAge')}
        hueOffset={HUE_OFFSET.minAge}
        value={choice}
        onChange={(next) => {
          setCustom(next === 'custom')
          onChange(minAgeDays(next, value ?? 0))
        }}
        options={options}
      />
      {choice === 'custom' && (
        <span className="flex items-center gap-2">
          <NumberField
            value={value ?? FIRST_CUSTOM}
            min={1}
            max={MAX_MIN_AGE}
            onChange={(days) => onChange(days > 0 ? days : undefined)}
            label={t('edit.minAgeUnit')}
          />
          <span className="text-body text-carbon-textSub">{t('edit.minAgeUnit')}</span>
        </span>
      )}
    </span>
  )
}
