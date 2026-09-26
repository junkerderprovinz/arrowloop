import { useEffect, useRef, useState } from 'react'

import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { Field, Text } from './Field'
import { IconConfirm } from './glyphs'
import { QRCode } from './QRCode'
import { StateLine } from './Shell'
import { replay } from '../lib/animate'
import { ApiError, api } from '../lib/api'
import { useT } from '../lib/i18n'

type Step =
  | { kind: 'idle' }
  | { kind: 'scan'; secret: string; uri: string }
  | { kind: 'codes'; codes: string[] }

/**
 * The second factor: a code from an authenticator app on top of the password.
 * It draws one state at a time: off, a three-step setup (scan, prove, write
 * the recovery codes down), or on.
 *
 * Two rules keep the owner from locking himself out. The status line reads
 * the server's answer, never the local step, so a setup left halfway never
 * looks armed. And the recovery codes, shown once, stay on screen until they
 * are acknowledged.
 */
export function TwoFactorCard({
  passwordSet,
  enabled,
  recoveryLeft,
  onChanged,
  hueIndex,
}: {
  /** A second factor with no first one protects nothing, and the server
   *  refuses to set one up. */
  passwordSet: boolean
  enabled: boolean
  recoveryLeft?: number
  /** Called once the factor is armed or removed, so the page reads the state again. */
  onChanged: () => void
  hueIndex?: number
}) {
  const { t } = useT()
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [disarming, setDisarming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // One of the two copy buttons, whichever step is showing.
  const copyButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (copied) replay(copyButton.current, 'glim-confirm')
  }, [copied])

  function refusal(e: unknown): string {
    if (e instanceof ApiError && e.status === 429) return t('login.locked')
    if (e instanceof ApiError && (e.status === 400 || e.status === 403)) return t('twoFactor.codeInvalid')
    return (e as Error).message
  }

  async function begin() {
    setBusy(true)
    setError(null)
    try {
      const got = await api.totpSetup()
      setStep({ kind: 'scan', secret: got.secret, uri: got.uri })
      setCode('')
    } catch (e) {
      // The server's own words: "already on" is not a wrong code.
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const got = await api.totpConfirm(code)
      setStep({ kind: 'codes', codes: got.recoveryCodes })
      setCode('')
      onChanged()
    } catch (e) {
      setError(refusal(e))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    try {
      await api.totpDisable(code)
      setCode('')
      setDisarming(false)
      onChanged()
    } catch (e) {
      setError(refusal(e))
    } finally {
      setBusy(false)
    }
  }

  function copy(text: string) {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const cancel = (
    <Button
      label={t('confirm.cancel')}
      labelKey="confirm.cancel"
      onClick={() => {
        setStep({ kind: 'idle' })
        setDisarming(false)
        setCode('')
        setError(null)
      }}
    />
  )

  return (
    <Card title={t('twoFactor.title')} hint={t('twoFactor.hint')} hueIndex={hueIndex}>
      <StateLine on={enabled}>{enabled ? t('twoFactor.on') : t('twoFactor.off')}</StateLine>

      {!passwordSet && <p className="text-xs text-carbon-textSub">{t('twoFactor.needsPassword')}</p>}

      {passwordSet && !enabled && step.kind === 'idle' && (
        <div className="flex justify-end">
          <Button
            label={t('twoFactor.add')}
            labelKey="twoFactor.add"
            tone="accent"
            busy={busy}
            disabled={busy}
            onClick={() => void begin()}
          />
        </div>
      )}

      {/* Scan and prove on one screen, since the code is typed while the app
          is still open. The QR code for a phone that can scan, the secret for
          one that cannot. */}
      {step.kind === 'scan' && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim() !== '') void confirm()
          }}
        >
          <p className="text-sm text-carbon-text">{t('twoFactor.scan')}</p>
          <QRCode value={step.uri} size={196} className="self-start rounded-control" />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-carbon-textSub">{t('twoFactor.secretManual')}</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded-control bg-carbon-surface2 px-3 py-1.5 text-sm tracking-widest text-carbon-text">
                {step.secret}
              </code>
              <Button
                label={copied ? t('common.copied') : t('common.copy')}
                labelKey={copied ? 'common.copied' : 'common.copy'}
                glyph={copied ? <IconConfirm className="glim-check-draw" /> : undefined}
                ref={copyButton}
                onClick={() => copy(step.secret)}
              />
            </div>
          </div>
          <Field label={t('twoFactor.confirmCode')}>
            <Text value={code} onChange={setCode} placeholder="000000" code mono />
          </Field>
          {error && <p className="text-xs text-statusFail" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            {cancel}
            <Button
              label={t('twoFactor.confirm')}
              labelKey="twoFactor.confirm"
              tone="accent"
              type="submit"
              busy={busy}
              disabled={busy || code.trim() === ''}
            />
          </div>
        </form>
      )}

      {/* The codes, once. They are stored hashed, so only a deliberate
          acknowledgement puts them away. */}
      {step.kind === 'codes' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-carbon-text">{t('twoFactor.recoveryTitle')}</p>
          <p className="text-xs text-carbon-textSub">{t('twoFactor.recoveryOnce')}</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-control bg-carbon-surface2 p-4 font-mono text-sm text-carbon-text">
            {step.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button
              label={copied ? t('common.copied') : t('common.copy')}
              labelKey={copied ? 'common.copied' : 'common.copy'}
              glyph={copied ? <IconConfirm className="glim-check-draw" /> : undefined}
              ref={copyButton}
              onClick={() => copy(step.codes.join('\n'))}
            />
            <Button
              label={t('twoFactor.recoverySaved')}
              labelKey="twoFactor.recoverySaved"
              tone="accent"
              onClick={() => setStep({ kind: 'idle' })}
            />
          </div>
        </div>
      )}

      {/* Turning it off wants a live code, so a session somebody walked away
          from cannot remove the factor. */}
      {enabled && step.kind === 'idle' && (
        <div className="flex flex-col gap-3">
          {recoveryLeft !== undefined && (
            <p className="text-xs text-carbon-textSub">{t('twoFactor.recoveryLeft', { count: recoveryLeft })}</p>
          )}
          {!disarming ? (
            <div className="flex justify-end">
              <Button
                label={t('twoFactor.remove')}
                labelKey="twoFactor.remove"
                onClick={() => {
                  setError(null)
                  setDisarming(true)
                }}
              />
            </div>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (code.trim() !== '') void disable()
              }}
            >
              <Field label={t('twoFactor.disableCodePrompt')}>
                <Text value={code} onChange={setCode} placeholder="000000" code mono />
              </Field>
              {error && <p className="text-xs text-statusFail" role="alert">{error}</p>}
              <div className="flex justify-end gap-2">
                {cancel}
                <Button
                  label={t('twoFactor.remove')}
                  labelKey="twoFactor.remove"
                  tone="accent"
                  type="submit"
                  busy={busy}
                  disabled={busy || code.trim() === ''}
                />
              </div>
            </form>
          )}
        </div>
      )}

      {error && step.kind === 'idle' && !disarming && (
        <p className="text-xs text-statusFail" role="alert">{error}</p>
      )}
    </Card>
  )
}
