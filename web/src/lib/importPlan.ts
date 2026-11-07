// What a file from FolderSync or luckyBackup adds, as the engine maps it
// (internal/importer), and the sections the web and the phone show before
// anything is saved.

import type { Translate, TranslationKey } from './i18n.data'

export interface ImportPlan {
  source: 'ArrowLoop' | 'FolderSync' | 'luckyBackup'
  jobs: { name: string; left: string; right: string; direction?: string }[]
  targets: { name: string; type: string; settings: Record<string, string> }[]
  /** What a target needs typed in again, since no secret comes along. */
  fillIn: { subject: string; what: 'signIn' | 'password' | 'secretKey' }[]
  /** Settings with nothing like them here, quoted as the file spells them. */
  skipped: { subject: string; what: string }[]
}

export interface ImportSection {
  heading: string
  lines: string[]
}

const FILL: Record<ImportPlan['fillIn'][number]['what'], TranslationKey> = {
  signIn: 'import.fill.signIn',
  password: 'import.fill.password',
  secretKey: 'import.fill.secretKey',
}

const ARROW: Record<string, string> = { leftToRight: '→', rightToLeft: '←' }

export function importSections(plan: ImportPlan, t: Translate): ImportSection[] {
  const targets = t('nav.targets')
  const fillIn = plan.fillIn.map((n) => t(FILL[n.what], { target: n.subject, targets }))
  // luckyBackup keeps its schedule in cron, outside the profile.
  if (plan.source === 'luckyBackup' && plan.jobs.length > 0) fillIn.push(t('import.luckySchedule'))

  const sections: ImportSection[] = [
    {
      heading: t('import.jobs'),
      lines: plan.jobs.map((j) => `${j.name}: ${j.left} ${ARROW[j.direction ?? ''] ?? '↔'} ${j.right}`),
    },
    { heading: t('import.targets'), lines: plan.targets.map((tg) => `${tg.name} (${tg.type})`) },
    { heading: t('import.fillIn'), lines: fillIn },
    { heading: t('import.skipped'), lines: plan.skipped.map((n) => `${n.subject}: ${n.what}`) },
  ]
  return sections.filter((s) => s.lines.length > 0)
}
