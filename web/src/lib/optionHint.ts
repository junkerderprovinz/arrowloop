import type { TranslationKey } from './i18n.data'
import { hasOptionLabel } from './optionNames'

/**
 * What belongs in one field of a target, in the reader's own language.
 *
 * ONE COPY FOR BOTH FACES. The desktop had a careful version of this and the
 * phone had rclone's English help, and jdp read the phone's: "die info texte in
 * der zugangscard sind völlig nutzlos und auch in englisch." Both halves were
 * true, and the cause was that the two screens answered the same question from
 * two different places. There is now one answer and two callers.
 *
 * Three sources, most specific last, each allowed to be absent:
 *
 *  1. What THIS field is, in this app's own words.
 *  2. What this PRODUCT needs in it - the sign-in style, the shape of its
 *     address. Assembled from TOKENS the provider table carries rather than
 *     from prose stored there: that table has no language, so a sentence in it
 *     would be English in all forty-two.
 *  3. rclone's own help, and ONLY for a field this app has no name for. On the
 *     access card it was the thing being complained about: English, and for
 *     most fields a restatement of the label above it. Behind the advanced
 *     switch it is the opposite - somebody who opened that switch is looking
 *     for a setting they read about in rclone's documentation, and hiding its
 *     wording there would hide the thing they came for.
 */
type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

/** Just enough of an option for this to decide. Structural on purpose: the
 *  desktop and the phone declare their own types from the same engine. */
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
 *
 * Matched on rclone's OWN option names, which are the same in every language
 * and across every backend that has the concept. `pass` covers webdav, sftp,
 * ftp and smb; the S3 pair is spelled the same wherever rclone speaks S3.
 */
const SECRET_FIELDS = new Set(['pass', 'password', 'secret_access_key', 'key', 'api_key', 'token'])

/**
 * This app's own sentence per field.
 *
 * Hand-kept and short, because rclone carries hundreds of options across its
 * backends and no list will cover them. Each one says three things: what goes
 * in, where to get it, and the one trap - which is what separates an
 * explanation from a label repeated in longer words.
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
 * The general sentence for one field, which for the password field depends on
 * WHAT IT IS TALKING TO.
 *
 * The box is called `pass` on every backend that has one and does not mean the
 * same thing on any two of them: on SFTP or a share it is the account password,
 * and on a cloud it must be an app token. jdp, after reading the one sentence
 * that tried to cover both: "der infotext fürs passwort bei opencloud ist total
 * verwirrend. man soll ein App Token anlegen nicht das normale Passwort
 * nehmen!" He is right, and it is stronger than a preference - OpenCloud
 * refuses the sign-in password outright, so a hint that hedges sends somebody
 * to type the one credential that cannot work.
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

  // The shape of the address, where the product has one. The general sentence
  // says which KIND of address it is; this says what one looks like.
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
    // The product's own sentence REPLACES the general one rather than following
    // it, and that is not tidiness. The general text has to hold for every
    // backend; the specific one knows. Both together read as the bubble saying
    // the same thing twice in different words, which is what got the bubbles
    // reported in the first place. Measured on the deployed build: the
    // OpenCloud password bubble said "App-Passwort" in two consecutive
    // sentences.
    //
    // THE ONE EXCEPTION is an app password on a WebDAV backend, where the
    // general text is the more specific of the two - it names where the token
    // is made in Nextcloud and in OpenCloud, which the shared sentence cannot,
    // because the same sentence also serves iCloud and Koofr.
    const cloudToken = provider.auth === 'apppassword' && provider.backend === 'webdav'
    const said = cloudToken ? undefined : sentence[provider.auth]
    if (said) {
      about.push(t(said))
      own = undefined
    }
    if (provider.authUrl) about.push(t('help.authWhere', { url: provider.authUrl }))
  }

  if (own || about.length > 0) return [own, ...about].filter(Boolean).join(' ')

  // Nothing of our own: rclone's, but only for a field we have no name for, and
  // only when it says more than that name does.
  if (!o.help || hasOptionLabel(o.name)) return undefined
  return o.help
}
