import { useCallback, useEffect, useRef, useState } from 'react'

import { OtherInstances } from '../../components/OtherInstances'
import { Stack } from '../../components/Shell'
import { api, type ConnectInfo, type RelayConfig } from '../../lib/api'
import { fortressHues, pairedWith, type FortressInfo } from '../../lib/fortress'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { useNavPins } from '../../lib/navPins'
import { pairStage } from '../../lib/pairing'
import { FortressSection } from './pairing/FortressSection'
import { GroupCard } from './pairing/GroupCard'
import { InstanceCard } from './pairing/InstanceCard'
import { PairingSteps } from './pairing/PairingSteps'
import { PhraseCard } from './pairing/PhraseCard'
import { RelayCard } from './pairing/RelayCard'

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
 * the rest, then the fortress. While Instances is not in the sidebar, its
 * cards follow. In a fortress its phrase is the pairing's, so the fortress
 * shows and changes it and the group's phrase card steps aside.
 */
export function PairingPage() {
  const { t } = useT()
  const [group, setGroup] = useState<ConnectInfo | null>(null)
  const [relay, setRelay] = useState<RelayConfig | null>(null)
  const [fortress, setFortress] = useState<FortressInfo | null>(null)
  const [error, setError] = useState(false)
  const [createdHere, setCreatedHere] = useState(false)
  const pinned = useNavPins().instances
  const joinedAgo = useJoinedAgo(group)
  // Counts the reads and the answers the cards hand up, so a read that was out
  // while a newer answer came back cannot put back the state from before.
  const asked = useRef(0)

  const load = useCallback(() => {
    const read = ++asked.current
    // The fortress has a card of its own, so a fortress that cannot be read
    // leaves the pairing cards standing.
    Promise.all([api.connect(), api.relay(), api.fortress().catch(() => null)])
      .then(([g, r, f]) => {
        if (read !== asked.current) return
        setGroup(g)
        setRelay(r)
        setFortress(f)
        setError(false)
      })
      .catch(() => read === asked.current && setError(true))
  }, [])

  const takeGroup = useCallback((g: ConnectInfo) => {
    asked.current++
    setGroup(g)
  }, [])

  // The engine says on its event stream when somebody comes, goes, waits or
  // is approved, or when the relay comes or goes. The other apps of the
  // fortress tell it nothing, so the page reads it again when it gets the
  // focus back.
  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    const unwatch = api.watch((ev) => {
      if (ev.phase === 'group') load()
    })
    return () => {
      window.removeEventListener('focus', load)
      unwatch()
    }
  }, [load])

  const stage = group ? pairStage(group, joinedAgo, createdHere) : 'unpaired'
  const inFortress = fortress?.joined === true

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
          {!inFortress && (
            <PhraseCard group={group} stage={stage} hueIndex={3} onCreatedHere={setCreatedHere} onGroup={takeGroup} onRefresh={load} />
          )}
          <GroupCard group={group} stage={stage} joinedAgo={joinedAgo} hueIndex={4} onRefresh={load} />
          <InstanceCard group={group} hueIndex={5} inFortress={inFortress} onGroup={takeGroup} onRefresh={load} />
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
          {fortress && (
            <FortressSection fortress={fortress} pairedWith={pairedWith(group)} hueStart={7} onFortress={setFortress} onRefresh={load} />
          )}
        </>
      )}
      {!pinned && <OtherInstances firstHue={7 + (fortress ? fortressHues(fortress) : 0)} />}
    </Stack>
  )
}
