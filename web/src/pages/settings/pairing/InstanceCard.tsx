import { useEffect, useRef, useState } from 'react'

import { FieldRow, Text } from '../../../components/Field'
import { api, type ConnectInfo } from '../../../lib/api'
import { Card } from '../../../lib/glimstone/Card'
import { InfoBubble } from '../../../lib/glimstone/InfoBubble'
import { useT } from '../../../lib/i18n'
import { refusalText } from '../../../lib/pairing'

/** How long typing has to pause before the name is saved. */
const SETTLE_MS = 800

/**
 * This instance as the others see it: the name it goes by, saved on its own
 * once typing pauses, and the key to compare when it waits for approval. In a
 * fortress the name goes to the fortress, which tells the other apps as well.
 */
export function InstanceCard({
  group,
  hueIndex,
  inFortress,
  onGroup,
  onRefresh,
}: {
  group: ConnectInfo
  hueIndex: number
  inFortress: boolean
  onGroup: (g: ConnectInfo) => void
  onRefresh: () => void
}) {
  const { t } = useT()
  const [name, setName] = useState(group.name)
  const [error, setError] = useState<string | null>(null)
  const typing = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  // The page reads the group again whenever it changes, which must not undo what is being typed.
  useEffect(() => {
    if (!typing.current) setName(group.name)
  }, [group.name])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  function type(next: string) {
    typing.current = true
    setName(next)
    setError(null)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const saved = inFortress ? api.nameInFortress(next).then(onRefresh) : api.renameInstance(next).then(onGroup)
      saved
        .catch((e: unknown) => setError(refusalText(t, e)))
        .finally(() => {
          typing.current = false
        })
    }, SETTLE_MS)
  }

  return (
    <Card title={t('pairing.thisInstance')} hueIndex={hueIndex}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <FieldRow label={t('pairing.nameLabel')} hint={t('pairing.nameHint')}>
            <Text value={name} onChange={type} label={t('pairing.nameLabel')} />
          </FieldRow>
          {error && <p className="text-end text-meta text-statusFail">{error}</p>}
        </div>
        {group.fingerprint && (
          <p className="flex items-center justify-end gap-1.5 text-subline text-carbon-textMuted">
            <span dir="ltr">
              {t('pairing.ownKey', { fingerprint: group.fingerprint })}
            </span>
            <InfoBubble tip={t('pairing.ownKeyTip')} />
          </p>
        )}
      </div>
    </Card>
  )
}
