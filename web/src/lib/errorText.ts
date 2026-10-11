import type { Translate } from './i18n.data'

/**
 * What to tell somebody about a failed call: the server's own words, except
 * where it answered with a code this interface says in the reader's language.
 */
export function errorText(t: Translate, e: unknown): string {
  if ((e as { code?: string })?.code === 'password-not-set') return t('error.passwordNotSet')
  return (e as Error).message
}
