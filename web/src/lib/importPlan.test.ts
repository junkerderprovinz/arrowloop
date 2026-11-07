import { describe, expect, it } from 'vitest'

import { ApiError } from './api'
import { errorText } from './errorText'
import { de, en } from './i18n'
import { importSections, type ImportPlan } from './importPlan'

const tFrom = (table: Record<string, string>) => (key: string, vars?: Record<string, string | number>) =>
  (table[key] ?? key).replace(/\{(\w+)\}/g, (all, name: string) => String(vars?.[name] ?? all))
const t = tFrom(en)

const plan: ImportPlan = {
  source: 'FolderSync',
  jobs: [
    { name: 'Camera', left: '/storage/emulated/0/DCIM', right: 'nas:/photos', direction: 'leftToRight' },
    { name: 'Scans', left: '/storage/emulated/0/Scans', right: 'office:team/scans', direction: 'rightToLeft' },
    { name: 'Notes', left: '/storage/emulated/0/Notes', right: 'cloud:Notes', direction: 'both' },
  ],
  targets: [{ name: 'nas', type: 'sftp', settings: { host: 'nas.lan' } }],
  fillIn: [
    { subject: 'nas', what: 'password' },
    { subject: 'cloud', what: 'signIn' },
  ],
  skipped: [{ subject: 'Camera', what: 'webhooks' }],
}

describe('what an import shows before it adds anything', () => {
  it('lists the jobs with the way they run, the targets, what to fill in and what stays behind', () => {
    const sections = importSections(plan, t)
    expect(sections.map((s) => s.heading)).toEqual([
      en['import.jobs'],
      en['import.targets'],
      en['import.fillIn'],
      en['import.skipped'],
    ])
    expect(sections[0].lines).toEqual([
      'Camera: /storage/emulated/0/DCIM → nas:/photos',
      'Scans: /storage/emulated/0/Scans ← office:team/scans',
      'Notes: /storage/emulated/0/Notes ↔ cloud:Notes',
    ])
    expect(sections[1].lines).toEqual(['nas (sftp)'])
    expect(sections[2].lines[0]).toContain('nas')
    expect(sections[2].lines[0]).toContain(en['nav.targets'])
    expect(sections[3].lines).toEqual(['Camera: webhooks'])
  })

  it('leaves out a section with nothing in it', () => {
    const sections = importSections({ ...plan, targets: [], fillIn: [], skipped: [] }, t)
    expect(sections.map((s) => s.heading)).toEqual([en['import.jobs']])
  })

  it('tells a luckyBackup user where the schedule went', () => {
    const sections = importSections({ ...plan, source: 'luckyBackup' }, t)
    expect(sections[2].lines).toContain(en['import.luckySchedule'])
  })

  it('speaks the reader’s language', () => {
    const sections = importSections(plan, tFrom(de))
    expect(sections[0].heading).toBe(de['import.jobs'])
    expect(sections[2].lines[1]).toContain(de['nav.targets'])
  })
})

describe('a file the import cannot take', () => {
  it('says which files it takes', () => {
    expect(errorText(t, new ApiError('cannot read this file', 400, 'import-unknown'))).toBe(en['import.unknown'])
  })

  it('explains the old luckyBackup format', () => {
    expect(errorText(t, new ApiError('old profile', 400, 'import-old-profile'))).toBe(en['import.oldProfile'])
  })
})
