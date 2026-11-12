import { useCallback, useEffect, useState } from 'react'

import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { ConfirmWindow } from './ConfirmWindow'
import { FieldRow, Text } from './Field'
import { IconAction } from './IconAction'
import { api, type ReadToken } from '../lib/api'
import { useT } from '../lib/i18n'

const STATUS_PATH = '/api/fortress/v1/status'
const LOG_PATH = '/api/fortress/v1/log'

/**
 * The tokens dashboards read ArrowLoop's state and log with. A new token is
 * shown once, since the engine keeps only its fingerprint; losing it means
 * making another.
 */
export function ReadTokenCard({ hueIndex }: { hueIndex?: number }) {
  const { t, lang } = useT()
  const [tokens, setTokens] = useState<ReadToken[]>([])
  const [name, setName] = useState('')
  const [made, setMade] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ReadToken | null>(null)

  const reload = useCallback(async () => {
    try {
      setTokens(await api.readTokens())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const answer = await api.addReadToken(name.trim() || 'Dashboard')
      setMade(answer.token)
      setName('')
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(token: ReadToken) {
    setBusy(true)
    setError(null)
    try {
      await api.deleteReadToken(token.id)
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('readToken.title')} hint={t('readToken.hint', { status: STATUS_PATH, log: LOG_PATH })} hueIndex={hueIndex}>
      {tokens.length === 0 ? (
        <p className="text-subline text-carbon-textSub">{t('readToken.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tokens.map((tok) => (
            <li
              key={tok.id}
              className="flex items-center justify-between gap-3 bg-carbon-surface2 px-3 py-2"
              style={{ borderRadius: 'var(--radius-control)' }}
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-body text-carbon-text">{tok.name}</span>
                <span className="truncate text-subline text-carbon-textSub">
                  {t('readToken.made', { date: new Date(tok.createdAt * 1000).toLocaleDateString(lang) })}
                </span>
              </div>
              <IconAction title={t('readToken.remove')} labelKey="readToken.remove" disabled={busy} onClick={() => setPendingDelete(tok)} />
            </li>
          ))}
        </ul>
      )}

      {made && (
        <div className="flex flex-col gap-2 rounded-control bg-statusWarnBg px-3 py-2.5">
          <p className="text-subline text-carbon-text">{t('readToken.once')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all font-mono text-meta text-carbon-text">{made}</code>
            <Button
              label={copied ? t('common.copied') : t('common.copy')}
              labelKey="common.copy"
              onClick={() => {
                void navigator.clipboard?.writeText(made).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
            />
          </div>
        </div>
      )}

      {error && <p className="text-subline text-statusFail" role="alert">{error}</p>}

      <form
        className="flex flex-wrap items-end justify-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <div className="min-w-0 flex-[1_1_16rem]">
          <FieldRow label={t('readToken.name')}>
            <Text value={name} onChange={setName} placeholder="Homepage" label={t('readToken.name')} />
          </FieldRow>
        </div>
        <Button label={t('readToken.add')} labelKey="readToken.add" type="submit" busy={busy} disabled={busy} />
      </form>

      {pendingDelete && (
        <ConfirmWindow
          title={t('readToken.removeTitle')}
          message={t('readToken.removeStakes', { name: pendingDelete.name })}
          confirmLabel={t('readToken.remove')}
          confirmLabelKey="readToken.remove"
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const tok = pendingDelete
            setPendingDelete(null)
            void remove(tok)
          }}
        />
      )}
    </Card>
  )
}
