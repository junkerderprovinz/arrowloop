import { describe, expect, it } from 'vitest'

import {
  amount,
  countBySeverity,
  direction,
  figures,
  globalBrakes,
  groupFindings,
  leadingAnswer,
  ownBrakes,
  sentence,
  share,
  shortLine,
  type Finding,
} from './anomalies'
import { en, type TranslationKey } from './i18n.data'

/** English with the placeholders filled, which is all these sentences need. */
function t(key: TranslationKey, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

const places: [string, string] = ['On the device', 'OpenCloud']

function finding(over: Partial<Finding>): Finding {
  return {
    id: 'a',
    job: 'fotos',
    kind: 'delete',
    severity: 'warning',
    held: true,
    since: '2026-03-01T10:00:00Z',
    seen: '2026-03-01T10:00:00Z',
    open: true,
    ...over,
  }
}

describe('grouping', () => {
  it('puts the job in most trouble first and its loudest finding on top', () => {
    const groups = groupFindings([
      finding({ id: '1', job: 'musik', kind: 'overdue', severity: 'info', held: false }),
      finding({ id: '2', job: 'download', kind: 'delete', severity: 'warning' }),
      finding({ id: '3', job: 'download', kind: 'change', severity: 'critical' }),
      finding({ id: '4', job: 'archiv', kind: 'failing', severity: 'warning', held: false }),
    ])
    expect(groups.map((g) => `${g.job}:${g.worst}`)).toEqual(['download:critical', 'archiv:warning', 'musik:info'])
    expect(groups[0]?.findings.map((f) => f.id)).toEqual(['3', '2'])
  })

  it('counts every severity, the absent ones as zero', () => {
    expect(countBySeverity([finding({}), finding({ severity: 'critical' }), finding({})])).toEqual({
      critical: 1,
      warning: 2,
      info: 0,
    })
  })
})

describe('a brake that refused', () => {
  const gone = finding({ count: 25, known: 40, limit: 50, onRight: 25 })

  it('rounds the share down, as the engine compares it', () => {
    expect(share(gone)).toBe(62)
  })

  it('names where the change was made and where it would land', () => {
    expect(direction(gone)).toEqual({ from: 'left', to: 'right' })
    expect(sentence(gone, t, places)).toBe(
      'This run would delete 25 of 40 files (62 %, limit 50 %). Deleted: On the device. Would be removed: OpenCloud.',
    )
  })

  it('names no side when deletions run both ways', () => {
    const mixed = finding({ count: 25, known: 40, limit: 50, onLeft: 5, onRight: 20 })
    expect(direction(mixed)).toBeNull()
    expect(sentence(mixed, t, places)).toBe('This run would delete 25 of 40 files (62 %, limit 50 %).')
  })

  it('gives the figures a person weighs the refusal with', () => {
    expect(figures(gone, t)).toEqual([
      ['Would delete', '25'],
      ['Known', '40'],
      ['Share', '62 %'],
      ['Limit', '50 %'],
    ])
  })
})

describe('a side that lists nothing', () => {
  const empty = finding({ kind: 'empty', severity: 'critical', side: 'right', known: 312 })

  it('goes by the name of the side that is empty', () => {
    expect(shortLine(empty, t, places)).toBe('OpenCloud')
    expect(sentence(empty, t, places)).toContain('(OpenCloud), while 312 are known')
  })
})

describe('the answer a card leads with', () => {
  it('is to run a mass deletion, which is usually meant', () => {
    expect(leadingAnswer(finding({}))).toBe('run')
  })

  it('is to take back what was rewritten or emptied', () => {
    expect(leadingAnswer(finding({ kind: 'change', severity: 'critical' }))).toBe('restore')
  })
})

describe('a job\'s own brakes', () => {
  const global = globalBrakes({ brakePercent: 40 })

  it('fills in the engine\'s values where the settings are silent', () => {
    expect(global).toEqual({ brakePercent: 40, changePercent: 50, brakeFloor: 10 })
  })

  it('are none while the job states neither', () => {
    expect(ownBrakes({}, global)).toBeNull()
    expect(ownBrakes(undefined, global)).toBeNull()
  })

  it('keep a zero, which switches the brake off for that job', () => {
    expect(ownBrakes({ brakePercent: 0 }, global)).toEqual({ brakePercent: 0, changePercent: 50 })
  })
})

describe('an unusual run', () => {
  it('says each figure that stood out with its usual range', () => {
    const odd = finding({
      kind: 'unusual',
      held: false,
      figures: [
        { figure: 'deleted', value: 412, low: 0, high: 6 },
        { figure: 'duration', value: 2820, low: 60, high: 180 },
      ],
    })
    expect(sentence(odd, t, places)).toBe('Files deleted: 412, usually 0 to 6. Run time: 47 min, usually 60 s to 3 min.')
    expect(shortLine(odd, t, places)).toBe('Files deleted: 412, usually 0 to 6.')
    expect(figures(odd, t)).toEqual([])
  })

  it('gives a time in the unit a reader takes it in', () => {
    expect(amount('duration', 45, t)).toBe('45 s')
    expect(amount('duration', 600, t)).toBe('10 min')
    expect(amount('duration', 3 * 3600, t)).toBe('3 h')
    expect(amount('deleted', 600, t)).toBe('600')
  })
})
