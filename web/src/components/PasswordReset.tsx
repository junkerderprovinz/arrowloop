import { useState } from 'react'

import { Card } from '../lib/glimstone/Card'
import { Button } from '../lib/glimstone/Button'
import { Field, Secret, Text } from './Field'
import { IconCancel } from './glyphs'
import { ApiError, api } from '../lib/api'
import { useT } from '../lib/i18n'

const MIN_LENGTH = 12

type Removed = { secondFactor: boolean; passkeys: number; sessions: number }

/**
 * A forgotten password, reset with a code the server writes to its own log.
 * Reading that log is what proves the owner, so the code is never shown here;
 * the page only says where to find it.
 */
export function PasswordReset({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useT()
  const [step, setStep] = useState<'ask' | 'code' | 'done'>('ask')
  const [minutes, setMinutes] = useState(10)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [removed, setRemoved] = useState<Removed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send() {
    setBusy(true)
    setError(null)
    try {
      setMinutes((await api.resetBegin()).minutes)
      setStep('code')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.resetFinish(code, password)
      setPassword('')
      setRemoved(res.removed)
      setStep('done')
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setError(t('login.locked'))
      else setError(t('reset.invalid'))
    } finally {
      setBusy(false)
    }
  }

  const gone = removed
    ? [
        removed.secondFactor && t('reset.removedFactor'),
        removed.passkeys > 0 && t('reset.removedPasskeys', { count: removed.passkeys }),
        removed.sessions > 0 && t('reset.removedSessions', { count: removed.sessions }),
      ].filter((x): x is string => !!x)
    : []

  return (
    <Card title={t('reset.title')} hueIndex={0}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (step === 'ask') void send()
          else if (step === 'code') void finish()
          else onDone()
        }}
      >
        {step === 'ask' && <p className="text-sm text-carbon-text">{t('reset.intro')}</p>}
        {step === 'code' && (
          <>
            <p className="text-sm text-carbon-text">{t('reset.where', { minutes })}</p>
            <Field label={t('reset.code')}>
              <Text value={code} onChange={setCode} placeholder="ABCD-EFGH-JKLM" mono />
            </Field>
            <Field label={t('reset.password')} hint={t('password.minLength', { count: MIN_LENGTH })}>
              <Secret value={password} onChange={setPassword} autoComplete="new-password" />
            </Field>
          </>
        )}
        {step === 'done' && (
          <div className="flex flex-col gap-2 text-sm text-carbon-text">
            <p>{gone.length > 0 ? t('reset.doneRemoved') : t('reset.done')}</p>
            {gone.length > 0 && (
              <ul className="list-disc ps-5">
                {gone.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Cleared at every attempt, so each refusal mounts it and shakes. */}
        {error && (
          <p className="glim-shake text-xs text-statusFail" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {step !== 'done' && (
            <Button
              label={t('confirm.cancel')}
              labelKey="confirm.cancel"
              glyph={<IconCancel />}
              disabled={busy}
              onClick={onCancel}
            />
          )}
          {step === 'ask' && (
            <Button label={t('reset.send')} labelKey="reset.send" tone="accent" type="submit" busy={busy} disabled={busy} />
          )}
          {step === 'code' && (
            <Button
              label={t('reset.submit')}
              labelKey="reset.submit"
              tone="accent"
              type="submit"
              busy={busy}
              disabled={busy || code.trim() === '' || [...password].length < MIN_LENGTH}
            />
          )}
          {step === 'done' && (
            <Button label={t('reset.continue')} labelKey="reset.continue" tone="accent" type="submit" />
          )}
        </div>
      </form>
    </Card>
  )
}
