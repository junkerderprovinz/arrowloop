import { useState } from 'react'

import { Text } from '../../../components/Field'
import { IconAdd, IconClose, IconServer } from '../../../components/glyphs'
import { api } from '../../../lib/api'
import { Button } from '../../../lib/glimstone/Button'
import { Card } from '../../../lib/glimstone/Card'
import { useT } from '../../../lib/i18n'
import { refusalText } from '../../../lib/pairing'
import { Row, Rows } from './parts'

/** An address as the owner typed it, without the scheme the engine adds. */
function shown(address: string): string {
  return address.replace(/^http:\/\//, '')
}

/**
 * Where instances of the group answer on this network, for one that cannot
 * find them by itself. Adding an address asks who answers there first, and
 * says who did or why nobody of the group does.
 */
export function AddressesCard({ addresses, hueIndex, onChange }: { addresses: string[]; hueIndex: number; onChange: () => void }) {
  const { t } = useT()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null)

  function add() {
    const address = typed.trim()
    if (!address) return
    setBusy(true)
    setSaid(null)
    api
      .addAddress(address)
      .then((found) => {
        setTyped('')
        setSaid({ text: t('pairing.addresses.found', { name: found.member.name || found.member.id }), ok: true })
        onChange()
      })
      .catch((e: unknown) => setSaid({ text: refusalText(t, e), ok: false }))
      .finally(() => setBusy(false))
  }

  function remove(address: string) {
    setBusy(true)
    setSaid(null)
    api
      .saveAddresses(addresses.filter((a) => a !== address))
      .then(onChange)
      .catch((e: unknown) => setSaid({ text: refusalText(t, e), ok: false }))
      .finally(() => setBusy(false))
  }

  return (
    <Card title={t('pairing.addresses.title')} hint={t('pairing.addresses.hint')} hueIndex={hueIndex}>
      <div className="flex flex-col gap-4">
        {addresses.length === 0 ? (
          <p className="text-body text-carbon-textMuted">{t('pairing.addresses.empty')}</p>
        ) : (
          <Rows>
            {addresses.map((a) => (
              <Row key={a} glyph={<IconServer />} name={shown(a)}>
                <Button
                  label={t('pairing.addresses.remove')}
                  labelKey="pairing.addresses.remove"
                  glyph={<IconClose />}
                  disabled={busy}
                  onClick={() => remove(a)}
                />
              </Row>
            ))}
          </Rows>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <div className="min-w-0 flex-1 basis-48" dir="ltr">
            <Text value={typed} onChange={setTyped} placeholder="192.168.1.10:8422" label={t('pairing.addresses.label')} mono />
          </div>
          <Button
            type="submit"
            label={t('pairing.addresses.add')}
            labelKey="pairing.addresses.add"
            glyph={<IconAdd />}
            tone="accent"
            busy={busy}
            disabled={busy || !typed.trim()}
          />
        </form>
        {said && (
          <p role="status" className={`text-meta ${said.ok ? 'text-statusOk' : 'text-statusFail'}`}>
            {said.text}
          </p>
        )}
      </div>
    </Card>
  )
}
