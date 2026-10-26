import type { Translate } from './i18n.data'

/**
 * What to tell somebody about a failed call: the server's own words, except
 * where it answered with a code this interface says in the reader's language.
 */
export function errorText(t: Translate, e: unknown): string {
  const { code, values } = (e ?? {}) as { code?: string; values?: Record<string, string> }
  if (code === 'password-not-set') return t('error.passwordNotSet')
  if (code === 'target-in-use') return t('targets.inUse', values)
  return (e as Error).message
}
