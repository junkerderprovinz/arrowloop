// Uploads an app bundle to a Google Play track and sends it for review.
//
//   node .github/scripts/play-upload.mjs <bundle.aab> [track]
//
// The service account key comes from PLAY_SERVICE_ACCOUNT_JSON (its contents,
// as the workflow passes it) or PLAY_SERVICE_ACCOUNT_FILE (a path, for a run by
// hand). The release notes are fastlane/metadata/android/<locale>/changelogs/
// <versionCode>.txt, the files F-Droid reads as well; a locale without one is
// left out, and Play shows none for it.

import { createSign } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const [bundle, track = 'alpha'] = process.argv.slice(2)
if (!bundle) {
  console.error('usage: play-upload.mjs <bundle.aab> [track]')
  process.exit(2)
}

const pkg = JSON.parse(readFileSync(join(root, 'mobile', 'app.json'), 'utf8')).expo.android.package
const key = JSON.parse(
  process.env.PLAY_SERVICE_ACCOUNT_JSON || readFileSync(process.env.PLAY_SERVICE_ACCOUNT_FILE || '', 'utf8'),
)

const b64url = (data) => Buffer.from(data).toString('base64url')

async function accessToken() {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 600,
  }
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

const token = await accessToken()
const api = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/edits`

async function call(method, url, body, type = 'application/json') {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
    body: type === 'application/json' && body ? JSON.stringify(body) : body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${url.replace(api, '')}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : {}
}

function releaseNotes(versionCode) {
  const locales = join(root, 'fastlane', 'metadata', 'android')
  return readdirSync(locales)
    .map((language) => ({ language, file: join(locales, language, 'changelogs', `${versionCode}.txt`) }))
    .filter(({ file }) => existsSync(file))
    .map(({ language, file }) => ({ language, text: readFileSync(file, 'utf8').trim() }))
}

const edit = await call('POST', api)
const uploaded = await call(
  'POST',
  `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${pkg}/edits/${edit.id}/bundles?uploadType=media`,
  readFileSync(bundle),
  'application/octet-stream',
)
const notes = releaseNotes(uploaded.versionCode)
await call('PUT', `${api}/${edit.id}/tracks/${track}`, {
  track,
  releases: [{ versionCodes: [String(uploaded.versionCode)], status: 'completed', releaseNotes: notes }],
})
await call('POST', `${api}/${edit.id}:commit`)
console.log(`${pkg} ${uploaded.versionCode} is on the ${track} track, with notes in ${notes.map((n) => n.language).join(', ') || 'no language'}`)
