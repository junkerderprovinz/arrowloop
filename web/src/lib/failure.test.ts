import { describe, expect, it } from 'vitest'

import { failureLine, sayFailure } from './failure'
import { de, en, type Translate, type Translations } from './i18n.data'

function tIn(table: Translations): Translate {
  return (key, vars) =>
    Object.entries(vars ?? {}).reduce((said, [name, value]) => said.replaceAll(`{${name}}`, String(value)), table[key])
}

const tooFull =
  'not enough room on the destination: the right side reports 16384 bytes free and this job would write at least 31649416331'
const space = { code: 'notEnoughSpace', params: { side: 'right', free: '16384', needed: '31649416331' } }

describe('a failed run in words', () => {
  it('says why there was no room, with its figures in the language', () => {
    expect(sayFailure(tooFull, space, tIn(de), 'de')).toEqual({
      said: 'Am Ziel (rechts) sind 16 KB frei, dieser Auftrag würde mindestens 29 GB schreiben.',
    })
    expect(sayFailure(tooFull, space, tIn(en), 'en').said).toBe(
      'The destination (right) has 16 KB free, and this job would write at least 29 GB.',
    )
  })

  it('names the side it could not reach', () => {
    const failure = { code: 'unreachable', params: { side: 'left' } }
    expect(sayFailure('left side "nas:photos": connection refused', failure, tIn(de), 'de').said).toBe(
      'Die linke Seite war nicht erreichbar.',
    )
  })

  it('tells what to do about an FTP server out of logins', () => {
    const failure = { code: 'tooManyLogins' }
    expect(sayFailure('421 "Maximum login limit has been reached."', failure, tIn(en), 'en').said).toContain('lower concurrency')
  })

  it('says a sign-in rclone cannot make by itself needs the password again', () => {
    const raw = 'mnemonic is required - please run: rclone config reconnect :internxt,email=me@example.invalid:'
    expect(failureLine(raw, { code: 'signInAgain' }, tIn(en), 'en')).toBe(en['failure.signInAgain'])
    expect(failureLine(raw, { code: 'signInAgain', params: { side: 'right' } }, tIn(de), 'de')).toBe(de['failure.signInAgain'])
  })

  it('tells a refused two-factor code from a wrong password', () => {
    const raw = 'login failed: failed to access: access: Wrong 2-factor auth code (status 401)'
    expect(sayFailure(raw, { code: 'twoFactorRefused' }, tIn(en), 'en').said).toMatch(/two-factor code was not accepted/)
  })

  it('keeps what a command printed under its sentence', () => {
    const failure = { code: 'beforeFailed', params: { output: 'exit status 2' } }
    expect(failureLine('the command before the run failed, so the run did not start: exit status 2', failure, tIn(en), 'en')).toBe(
      'The command before the run failed, so the run did not start. exit status 2',
    )
  })

  it("leaves the VPN's own English off the one-line failure", () => {
    const failure = { code: 'vpnDown', params: { output: 'WireGuard: vpn: resolve vpn.example.net: no such host' } }
    const raw = `the VPN did not come up, so the run did not start: ${failure.params.output}`
    expect(failureLine(raw, failure, tIn(de), 'de')).toBe(de['failure.vpnDown'])
  })

  it('says a VPN that did not come up for a look at the sides without calling it a run', () => {
    const failure = { code: 'vpnUnreached', params: { output: 'WireGuard: no handshake with 203.0.113.9:51820 within 45s' } }
    const raw = `the VPN did not come up, so the job's sides could not be reached: ${failure.params.output}`
    expect(failureLine(raw, failure, tIn(en), 'en')).toBe(en['failure.vpnUnreached'])
    expect(en['failure.vpnUnreached']).not.toMatch(/run/)
  })

  it("says which side refused the trash, without the backend's English", () => {
    const raw = 'the trash cannot be kept on the right side: mkdir "/.arrowloop" failed: permission denied'
    expect(sayFailure(raw, { code: 'trashRefused', params: { side: 'right' } }, tIn(de), 'de')).toEqual({
      said: de['failure.trashRefused.right'],
    })
  })

  it('names the files left for later twice under its sentence', () => {
    const failure = { code: 'leftTwice', params: { output: 'photo.jpg (copy failed)' } }
    expect(sayFailure('left for later in two runs in a row: photo.jpg (copy failed)', failure, tIn(de), 'de')).toEqual({
      said: 'Einige Dateien ließen sich zwei Läufe hintereinander nicht übertragen. Die Liste des Laufs zeigt, welche und warum.',
      engine: 'photo.jpg (copy failed)',
    })
  })

  const pipe = {
    path: 'status.fifo',
    code: 'unsupported',
    vars: { kind: 'named pipe', side: 'left' },
    text: 'On the left there is named pipe, which this engine does not carry.',
  }
  const twiceRaw = `left for later in two runs in a row: status.fifo (${pipe.text}); and 2 more`

  it('says the files left for later twice in the language, from their codes', () => {
    const failure = { code: 'leftTwice', params: { output: `status.fifo (${pipe.text}); and 2 more` }, twice: { files: [pipe], more: 2 } }
    expect(sayFailure(twiceRaw, failure, tIn(de), 'de')).toEqual({
      said: de['failure.leftTwice'],
      files: [
        'status.fifo: Links liegt eine benannte Pipe. So etwas nimmt dieser Dienst nicht mit.',
        'Weitere liegen gelassene Dateien: 2.',
      ],
    })
    expect(failureLine(twiceRaw, failure, tIn(de), 'de')).toBe(
      `${de['failure.leftTwice']} status.fifo: Links liegt eine benannte Pipe. So etwas nimmt dieser Dienst nicht mit. Weitere liegen gelassene Dateien: 2.`,
    )
  })

  it("keeps the engine's English for a file whose reason this build has no words for", () => {
    const newer = { path: 'odd.bin', code: 'fromTheFuture', text: 'A reason from a newer engine.' }
    const failure = { code: 'leftTwice', twice: { files: [newer] } }
    // Both surfaces hand back the key itself for a sentence they do not have.
    const t: Translate = (key, vars) => (key in de ? tIn(de)(key, vars) : key)
    expect(sayFailure(twiceRaw, failure, t, 'de').files).toEqual(['odd.bin: A reason from a newer engine.'])
  })

  it("shows an error it has no words for as the engine's own, under a lead", () => {
    expect(sayFailure('something nobody planned for', undefined, tIn(de), 'de')).toEqual({
      said: 'Meldung des Motors:',
      engine: 'something nobody planned for',
    })
  })

  it("falls back to the engine's words for a kind this version does not know", () => {
    expect(sayFailure('raw', { code: 'fromTheFuture' }, tIn(en), 'en').engine).toBe('raw')
  })
})
