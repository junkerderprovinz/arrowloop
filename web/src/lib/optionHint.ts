// What belongs in one field of a target, in the reader's language, for both the
// desktop and the phone. Three sources, each allowed to be absent:
//
//  1. What this field is, in this app's own words.
//  2. What this product needs in it, the sign-in style and the shape of its
//     address, built from tokens in the provider table, which has no language.
//  3. rclone's own help, only for a field this app has no name for, which is
//     where somebody following rclone's documentation looks.

import type { TranslationKey } from './i18n.data'
import { hasOptionLabel } from './optionNames'

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

/** Just enough of an option for this to decide. Structural, because the
 *  desktop and the phone declare their own types. */
export type HintOption = { name: string; help?: string }

/** Likewise the product, which may not be known at all for a raw backend. */
export type HintProvider = {
  backend?: string
  auth?: string
  urlHint?: string
  authUrl?: string
}

/**
 * Which fields carry the credential, so the sign-in sentence lands on them.
 * rclone's option names are the same across backends: `pass` covers webdav,
 * sftp, ftp and smb.
 */
const SECRET_FIELDS = new Set(['pass', 'password', 'secret_access_key', 'key', 'api_key', 'token'])

/**
 * This app's own sentence per field: what goes in, where to get it, and the
 * one trap. Hand-kept for the common fields only.
 */
const GENERAL: Record<string, TranslationKey> = {
  url: 'opt.urlHint',
  user: 'opt.userHint',
  username: 'opt.userHint',
  pass: 'opt.passHint',
  password: 'opt.passHint',
  host: 'opt.hostHint',
  port: 'opt.portHint',
  token: 'opt.tokenHint',
  access_key_id: 'opt.accessKeyHint',
  secret_access_key: 'opt.secretKeyHint',
  endpoint: 'opt.endpointHint',
  region: 'opt.regionHint',
  vendor: 'opt.vendorHelp',
  key_file: 'opt.keyFileHelp',
}

/**
 * The general sentence for one field. The password field depends on the
 * backend: on SFTP or a share it is the account password, while a WebDAV cloud
 * such as OpenCloud refuses that and needs an app token.
 */
function general(o: HintOption, provider: HintProvider | null | undefined, t: Translate) {
  if ((o.name === 'pass' || o.name === 'password') && provider?.backend === 'webdav') {
    return t('opt.passCloudHint')
  }
  const key = GENERAL[o.name]
  return key ? t(key) : undefined
}

/** Everything the bubble beside one field can say, joined. */
export function optionHint(
  o: HintOption,
  t: Translate,
  provider?: HintProvider | null,
): string | undefined {
  let own = general(o, provider, t)
  const about: string[] = []

  // The general sentence says which kind of address; this shows what one looks like.
  if (o.name === 'url' && provider?.urlHint) {
    about.push(t('help.addressShape', { shape: provider.urlHint }))
  }

  if (SECRET_FIELDS.has(o.name) && provider?.auth) {
    const sentence: Record<string, TranslationKey> = {
      apppassword: 'help.authAppPassword',
      accesskey: 'help.authAccessKey',
      apikey: 'help.authApiKey',
      oauth: 'help.authOauth',
      login: 'help.authLogin',
    }
    // The product's sentence replaces the general one, or the bubble says the
    // same thing twice. Except for an app password on WebDAV, where the general
    // text is more specific: it names where Nextcloud and OpenCloud make the
    // token, which the shared sentence also serving iCloud and Koofr cannot.
    const cloudToken = provider.auth === 'apppassword' && provider.backend === 'webdav'
    const said = cloudToken ? undefined : sentence[provider.auth]
    if (said) {
      about.push(t(said))
      own = undefined
    }
    if (provider.authUrl) about.push(t('help.authWhere', { url: provider.authUrl }))
  }

  if (own || about.length > 0) return [own, ...about].filter(Boolean).join(' ')

  // rclone's help, only for a field without a name of our own.
  if (!o.help || hasOptionLabel(o.name)) return undefined
  return o.help
}
