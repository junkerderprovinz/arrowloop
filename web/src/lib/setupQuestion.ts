// The words for a question rclone's own setup of a backend leaves to the
// person adding a target (internal/remotes/setup.go), for the browser and the
// phone alike.

import type { TranslationKey } from './i18n.data'

/** Just enough of a question for this to decide. */
type Asked = { name: string; choices: unknown[] }

/** The questions rclone's setups ask, by the setting that answers them. */
const LABELS: Record<string, TranslationKey> = {
  config_driveid: 'targets.question.drive',
  config_workspace: 'targets.question.workspace',
  config_team_drive_id: 'targets.question.team',
  config_2fa: 'targets.question.code',
}

/** Whether the answer is typed in rather than picked, as a two-factor code is. */
export function typedAnswer(q: Asked): boolean {
  return q.choices.length === 0
}

/** Whether the answer is a one-time code, which a phone types on its number pad. */
export function oneTimeCode(q: Asked): boolean {
  return q.name === 'config_2fa'
}

export function questionLabel(q: Asked): TranslationKey {
  return LABELS[q.name] ?? (typedAnswer(q) ? 'targets.question.answer' : 'targets.question.other')
}

export function questionHint(q: Asked): TranslationKey {
  if (oneTimeCode(q)) return 'targets.question.codeHint'
  return typedAnswer(q) ? 'targets.question.typeHint' : 'targets.question.hint'
}
