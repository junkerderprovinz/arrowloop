import { useCallback, useEffect, useState } from 'react'

import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { Field, Text } from './Field'
import { IconAction } from './IconAction'
import { StateLine } from './Shell'
import { api, passkeysAvailableInBrowser, type PasskeyStatus, type PasskeyView } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * Signing in with a key on a phone, a laptop or a security stick instead of
 * typing the password.
 *
 * A passkey is bound to a host name, and browsers refuse the exchange on a
 * bare IP or a page that is not secure. Most installs are opened exactly that
 * way, so the card's first job is saying why there is nothing to click before
 * the browser answers with NotAllowedError.
 *
 * The password stays: a lost phone must not lock anybody out. A key also
 * belongs to one address, so the list says which one each key is for.
 */
export function PasskeyCard({ passwordSet, hueIndex }: { passwordSet: boolean; hueIndex?: number }) {
  const { t } = useT()
  const [status, setStatus] = useState<PasskeyStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PasskeyView | null>(null)

  const reload = useCallback(async () => {
    try {
      setStatus(await api.passkeys())
    } catch {
      // An engine that does not answer cannot carry a passkey either, and the
      // card says so below.
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const browserOK = passkeysAvailableInBrowser()
  const addressOK = status?.supported === true
  const keys = status?.passkeys ?? []

  async function add() {
    setBusy(true)
    setError(null)
    try {
      await api.registerPasskey(name.trim() || t('passkey.defaultName'))
      setName('')
      setAdding(false)
      await reload()
    } catch (e) {
      // A cancelled prompt, a timeout or an authenticator that declined all
      // land here, and the browser's own message says more than a generic one.
      setError(e instanceof Error && e.message ? e.message : t('passkey.failed'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: PasskeyView) {
    setBusy(true)
    setError(null)
    try {
      await api.deletePasskey(p.id)
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('passkey.title')} hint={t('passkey.hint')} hueIndex={hueIndex}>
      <StateLine on={keys.length > 0}>
        {keys.length > 0 ? t('passkey.on', { count: keys.length }) : t('passkey.off')}
      </StateLine>

      {!passwordSet && <p className="text-xs text-carbon-textSub">{t('passkey.needsPassword')}</p>}

      {/* The card's own translated paragraph rather than the server's English
          reason: it explains the whole feature, it is not an error. */}
      {passwordSet && !addressOK && (
        <div className="rounded-control bg-statusWarnBg px-3 py-2.5 text-sm leading-relaxed text-carbon-text">
          <p className="font-medium">{t('passkey.notHere')}</p>
          <p className="mt-1 text-xs text-carbon-textSub">{t('passkey.needsDomain')}</p>
        </div>
      )}

      {passwordSet && addressOK && !browserOK && <p className="text-xs text-statusWarn">{t('passkey.noBrowser')}</p>}

      {/* Every key is listed, those for other addresses too, or a key somebody
          registered would look lost. */}
      {keys.length > 0 && (
        <ul className="flex flex-col gap-2">
          {keys.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 bg-carbon-surface2 px-3 py-2"
              style={{ borderRadius: 'var(--radius-control)' }}
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-carbon-text">{p.name}</span>
                <span className="truncate text-xs text-carbon-textSub">
                  {p.usableHere ? t('passkey.usableHere') : t('passkey.otherAddress', { host: p.rpId })}
                  {!p.backedUp && <> · {t('passkey.notSynced')}</>}
                </span>
              </div>
              <IconAction
                title={t('passkey.remove')}
                labelKey="passkey.remove"
                disabled={busy}
                onClick={() => setPendingDelete(p)}
              />
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-statusFail" role="alert">{error}</p>}

      {passwordSet && addressOK && browserOK && !adding && (
        <div className="flex justify-end">
          <Button
            label={t('passkey.add')}
            labelKey="passkey.add"
            tone="accent"
            disabled={busy}
            onClick={() => {
              setError(null)
              setAdding(true)
            }}
          />
        </div>
      )}

      {/* The name is the owner's own label and means nothing to the protocol,
          so an empty one is filled in rather than refused. */}
      {adding && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <Field label={t('passkey.nameLabel')}>
            <Text value={name} onChange={setName} placeholder={t('passkey.namePlaceholder')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              label={t('confirm.cancel')}
              labelKey="confirm.cancel"
              onClick={() => {
                setAdding(false)
                setName('')
              }}
            />
            <Button
              label={t('passkey.create')}
              labelKey="passkey.create"
              tone="accent"
              type="submit"
              busy={busy}
              disabled={busy}
            />
          </div>
        </form>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t('passkey.removeTitle')}
          message={t('passkey.removeStakes', { name: pendingDelete.name })}
          confirmLabel={t('passkey.remove')}
          confirmLabelKey="passkey.remove"
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const p = pendingDelete
            setPendingDelete(null)
            void remove(p)
          }}
        />
      )}
    </Card>
  )
}
