import { useState } from 'react'

import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { Field, Secret } from './Field'
import { StateLine } from './Shell'
import { ApiError, api, type SecurityStatus } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * Sets, changes and removes the password. A change and a removal both want the
 * current password, so a session somebody walked away from cannot be used to
 * take the install over. A password from ARROWLOOP_PASSWORD_HASH is shown as
 * such and cannot be edited here.
 *
 * The save is a button rather than saving as the fields change: two fields
 * have to agree first, and the write locks or unlocks the whole interface.
 */
export function PasswordCard({
  status,
  onChanged,
  hueIndex,
}: {
  status: SecurityStatus
  onChanged: (next: SecurityStatus) => void
  hueIndex?: number
}) {
  const { t } = useT()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const source = status.password
  const set = source !== 'none'
  const min = status.minPasswordLen

  function refusal(e: unknown): string {
    if (e instanceof ApiError && e.status === 403) return t('login.wrong')
    if (e instanceof ApiError && e.status === 429) return t('login.locked')
    return (e as Error).message
  }

  function clear() {
    setCurrent('')
    setNext('')
    setRepeat('')
  }

  async function save() {
    setDone(null)
    if (next !== repeat) {
      setError(t('password.mismatch'))
      return
    }
    // Counted in characters, as the server counts.
    if ([...next].length < min) {
      setError(t('password.minLength', { count: min }))
      return
    }
    if (source === 'file' && current === '') {
      setError(t('password.currentNeeded'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const got = await api.setPassword(next, current)
      clear()
      setDone(t('password.saved'))
      onChanged(got)
    } catch (e) {
      setError(refusal(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const got = await api.removePassword(current)
      clear()
      setDone(t('password.removed'))
      onChanged(got)
    } catch (e) {
      setError(refusal(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('login.password')} hint={t('password.hint')} hueIndex={hueIndex}>
      <StateLine on={set}>{set ? t('password.on') : t('password.off')}</StateLine>

      {source === 'env' ? (
        <p className="text-xs text-carbon-textSub">{t('password.env')}</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {source === 'file' && (
            <Field label={t('password.current')}>
              <Secret value={current} onChange={setCurrent} autoComplete="current-password" />
            </Field>
          )}
          <Field label={t('password.new')}>
            <Secret value={next} onChange={setNext} autoComplete="new-password" />
          </Field>
          <Field label={t('password.repeat')}>
            <Secret value={repeat} onChange={setRepeat} autoComplete="new-password" />
          </Field>
          {/* The rule, stated before it is broken. */}
          <p className="text-xs text-carbon-textMuted">{t('password.minLength', { count: min })}</p>

          {error && <p className="text-xs text-statusFail" role="alert">{error}</p>}
          {done && <p className="text-xs text-statusOk" role="status">{done}</p>}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {source === 'file' && (
              <Button
                label={t('password.remove')}
                labelKey="password.remove"
                disabled={busy}
                onClick={() => {
                  setDone(null)
                  if (current === '') {
                    setError(t('password.currentNeeded'))
                    return
                  }
                  setError(null)
                  setConfirmRemove(true)
                }}
              />
            )}
            <Button
              label={set ? t('password.saveChange') : t('password.saveFirst')}
              labelKey={set ? 'password.saveChange' : 'password.saveFirst'}
              tone="accent"
              type="submit"
              busy={busy}
              disabled={busy || next === '' || repeat === ''}
            />
          </div>
        </form>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={t('password.removeTitle')}
          message={t('password.removeStakes')}
          confirmLabel={t('password.remove')}
          confirmLabelKey="password.remove"
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false)
            void remove()
          }}
        />
      )}
    </Card>
  )
}
