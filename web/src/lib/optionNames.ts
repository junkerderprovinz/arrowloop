import type { TranslationKey } from './i18n'

/**
 * The rclone option names people actually see, in words.
 *
 * rclone names its settings for its own configuration file: `pass`, `user`,
 * `access_key_id`, `sse_kms_key_id`. Those are correct and they are what goes
 * INTO the file, and putting them on a form label leaves somebody reading
 * `pass` above an empty box in a program that is otherwise entirely in their
 * own language. jdp: "zb. User und Pass, die ganzen begriffe sollen alle in die
 * sprachen übersetzt werden."
 *
 * Only the ones a form actually shows are here, which is the ones marked
 * required or essential - about twenty names across every backend. An option
 * behind the advanced switch keeps its rclone name deliberately: somebody who
 * opened that switch is looking for a specific setting they read about in
 * rclone's own documentation, and translating it there would hide the thing
 * they came for.
 *
 * A name with no entry falls back to itself, so a backend gaining an option
 * shows it rather than nothing.
 */
const NAMES: Record<string, TranslationKey> = {
  user: 'opt.user',
  username: 'opt.user',
  pass: 'opt.pass',
  password: 'opt.pass',
  host: 'opt.host',
  url: 'opt.url',
  port: 'opt.port',
  domain: 'opt.domain',
  token: 'opt.token',
  vendor: 'opt.vendor',
  provider: 'opt.provider',
  region: 'opt.region',
  endpoint: 'opt.endpoint',
  account: 'opt.account',
  key: 'opt.key',
  key_file: 'opt.keyFile',
  access_key_id: 'opt.accessKey',
  secret_access_key: 'opt.secretKey',
  access_grant: 'opt.accessGrant',
  client_id: 'opt.clientId',
  client_secret: 'opt.clientSecret',
  remote: 'opt.remote',
  library: 'opt.library',
  hostname: 'opt.hostname',
  drive_id: 'opt.driveId',
  drive_type: 'opt.driveType',
  scope: 'opt.scope',
  '2fa': 'opt.twoFactor',
}

/**
 * The label for one option: its own words where we have them, its rclone name
 * otherwise.
 *
 * The rclone name is kept alongside the translated one rather than replaced, so
 * anybody following rclone's documentation can still find the field. The
 * translation is what the eye reads; the original is what the search finds.
 */
export function optionLabel(name: string, t: (key: TranslationKey) => string): string {
  const key = NAMES[name]
  return key ? t(key) : name
}

/** Whether this option has a translated name at all. */
export function hasOptionLabel(name: string): boolean {
  return NAMES[name] !== undefined
}

/**
 * The bubble beside a field: an explanation, where there is one to give.
 *
 * rclone's own help was being shown there, prefixed with the option's rclone
 * name, and for most fields that produced "user - User name." under a label
 * already reading Benutzername. jdp: "die texte der i infobubble sind nicht
 * richtig." A bubble that restates its own label is worse than no bubble: it
 * promises an explanation and spends the reader's attention on nothing.
 *
 * So only the fields with something to SAY have one. The rest show rclone's
 * help if it adds anything, and nothing at all if it does not - see
 * optionHint() in the form.
 */
const EXPLAIN: Record<string, TranslationKey> = {
  url: 'opt.urlHelp',
  pass: 'opt.passHelp',
  password: 'opt.passHelp',
  vendor: 'opt.vendorHelp',
  key_file: 'opt.keyFileHelp',
}

/** This option's own explanation, or undefined where it needs none. */
export function optionExplain(
  name: string,
  t: (key: TranslationKey) => string,
): string | undefined {
  const key = EXPLAIN[name]
  return key ? t(key) : undefined
}
