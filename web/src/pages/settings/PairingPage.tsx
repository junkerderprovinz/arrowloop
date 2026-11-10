import { useCallback, useEffect, useRef, useState } from 'react'

import { OtherInstances } from '../../components/OtherInstances'
import { Stack } from '../../components/Shell'
import { api, type ConnectInfo, type RelayConfig } from '../../lib/api'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { useNavPins } from '../../lib/navPins'
import { pairStage } from '../../lib/pairing'
import { AddressesCard } from './pairing/AddressesCard'
import { GroupCard } from './pairing/GroupCard'
import { InstanceCard } from './pairing/InstanceCard'
import { PairingSteps } from './pairing/PairingSteps'
import { PhraseCard } from './pairing/PhraseCard'
import { RelayCard } from './pairing/RelayCard'

// How often the tile asks again who is there. Members come and go with the
// relay connection, which nothing pushes here, and asking is also what lets
// two instances meet and pin each other's key.
const REFRESH_MS = 10_000

/**
 * Counts on from the seconds the engine last reported, so the search timer
 * runs and the minute passes between two reads of the group.
 */
function useJoinedAgo(group: ConnectInfo | null): number {
  const [base, setBase] = useState({ ago: 0, at: Date.now() })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const at = Date.now()
    setBase({ ago: group?.joinedAgo ?? 0, at })
    setNow(at)
  }, [group])
  const waiting = !!group?.active && group.members.length === 0 && !group.memberSeen
  useEffect(() => {
    if (!waiting) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [waiting])
  return base.ago + Math.max(0, Math.floor((now - base.at) / 1000))
}

/**
 * Pairing, as in BombVault and KnightLoader: three steps that explain it, the
 * twelve words, who came with them, this instance, and the relay that carries
 * the rest. While Instances is not in the sidebar, its cards follow.
 */
export function PairingPage() {
  const { t } = useT()
  const [group, setGroup] = useState<ConnectInfo | null>(null)
  const [relay, setRelay] = useState<RelayConfig | null>(null)
  const [error, setError] = useState(false)
  const [createdHere, setCreatedHere] = useState(false)
  const pinned = useNavPins().instances
  const joinedAgo = useJoinedAgo(group)
  // Counts the reads and the answers the cards hand up, so a read that was out
  // while a newer answer came back cannot put back the state from before.
  const asked = useRef(0)

  const load = useCallback(() => {
    const read = ++asked.current
    Promise.all([api.connect(), api.relay()])
      .then(([g, r]) => {
        if (read !== asked.current) return
        setGroup(g)
        setRelay(r)
        setError(false)
      })
      .catch(() => read === asked.current && setError(true))
  }, [])

  const takeGroup = useCallback((g: ConnectInfo) => {
    asked.current++
    setGroup(g)
  }, [])

  useEffect(() => {
    load()
    const id = window.setInterval(load, REFRESH_MS)
    return () => window.clearInterval(id)
  }, [load])

  const stage = group ? pairStage(group, joinedAgo, createdHere) : 'unpaired'

  return (
    <Stack>
      <PairingSteps hues={[0, 1, 2]} />
      {error && (
        <Card title={t('settings.pairing')} hueIndex={3}>
          <p className="text-subline text-statusFail">{t('pairing.loadError')}</p>
        </Card>
      )}
      {group && (
        <>
          <PhraseCard group={group} stage={stage} hueIndex={3} onCreatedHere={setCreatedHere} onGroup={takeGroup} onRefresh={load} />
          <GroupCard group={group} stage={stage} joinedAgo={joinedAgo} hueIndex={4} onRefresh={load} />
          <InstanceCard group={group} hueIndex={5} onGroup={takeGroup} />
          {relay && (
            <RelayCard
              group={group}
              relay={relay}
              stage={stage}
              hueIndex={6}
              onRelay={(r) => {
                setRelay(r)
                load()
              }}
              onRefresh={load}
            />
          )}
          {group.active && <AddressesCard addresses={group.addresses} hueIndex={7} onChange={load} />}
        </>
      )}
      {!pinned && <OtherInstances firstHue={8} />}
    </Stack>
  )
}
