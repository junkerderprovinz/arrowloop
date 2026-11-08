import { useEffect, useRef, useState } from 'react'

import { Dialog } from '../../../components/Dialog'
import { FieldRow, Text } from '../../../components/Field'
import { IconClose, IconEye, IconRetry } from '../../../components/glyphs'
import { Selector } from '../../../components/Selector'
import { api, type ConnectInfo, type RelayConfig, type RelayMode } from '../../../lib/api'
import { Badge } from '../../../lib/glimstone/Badge'
import { Button } from '../../../lib/glimstone/Button'
import { Card } from '../../../lib/glimstone/Card'
import { InfoBubble } from '../../../lib/glimstone/InfoBubble'
import { useT, type TranslationKey } from '../../../lib/i18n'
import { refusalText, type PairStage } from '../../../lib/pairing'
import { useToast } from '../../../lib/toast'
import { FactGlyph, RouteDiagram, RouteGlyph } from './pairingArt'
import { CardFoot, Fact, Lead } from './parts'

const MODES: RelayMode[] = ['project', 'own', 'off']

const COPY: Record<RelayMode, { name: TranslationKey; sentence: TranslationKey; need: TranslationKey }> = {
  project: { name: 'relay.project', sentence: 'relay.projectSentence', need: 'relay.projectNeed' },
  own: { name: 'relay.own', sentence: 'relay.ownSentence', need: 'relay.ownNeed' },
  off: { name: 'relay.off', sentence: 'relay.offSentence', need: 'relay.offNeed' },
}

/** How long typing has to pause before the address is saved. */
const SETTLE_MS = 800

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Which relay carries the group: the project's, one of the owner's own, or
 * none. Each route says in one sentence what it is and what it needs, beside a
 * picture of a message on its way. Every control saves on its own.
 */
export function RelayCard({ group, relay, stage, hueIndex, onRelay, onRefresh }: {
  group: ConnectInfo
  relay: RelayConfig
  stage: PairStage
  hueIndex: number
  onRelay: (r: RelayConfig) => void
  onRefresh: () => void
}) {
  const { t } = useT()
  const push = useToast()
  const [mode, setMode] = useState<RelayMode>(relay.mode)
  const [address, setAddress] = useState(relay.relayUrl)
  const [addressError, setAddressError] = useState<string | null>(null)
  const [seesOpen, setSeesOpen] = useState(false)
  const typing = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  // The page reads the relay every few seconds, which must not undo what is being typed or picked.
  useEffect(() => {
    if (!typing.current) setAddress(relay.relayUrl)
  }, [relay.relayUrl])
  useEffect(() => setMode(relay.mode), [relay.mode])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  function pick(next: RelayMode) {
    const before = mode
    setMode(next)
    api
      .saveRelay({ mode: next })
      .then(onRelay)
      .catch((e: unknown) => {
        setMode(before)
        push(refusalText(t, e), 'fail')
      })
  }

  function type(next: string) {
    typing.current = true
    setAddress(next)
    setAddressError(null)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      api
        .saveRelay({ relayUrl: next })
        .then(onRelay)
        .catch((e: unknown) => setAddressError(refusalText(t, e)))
        .finally(() => {
          typing.current = false
        })
    }, SETTLE_MS)
  }

  const copy = COPY[mode]
  // The relay key comes from the twelve words, so the relay is only dialled
  // inside a group; before that there is nothing to be connected.
  const state =
    mode === 'off' ? (
      <Badge tone="neutral" size="large">{t('relay.off')}</Badge>
    ) : !group.active ? (
      <Badge tone="neutral" size="large">{t('relay.noGroup')}</Badge>
    ) : relay.connected ? (
      <Badge tone="ok" size="large">{t('relay.connected')}</Badge>
    ) : (
      <Badge tone="warn" size="large">{t('relay.notConnected')}</Badge>
    )
  const [beforeHost, afterHost = ''] = t('pairing.relayCheckProject').split('{host}')

  return (
    <Card title={t('relay.title')} hint={t('relay.hint')} hueIndex={hueIndex}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Selector<RelayMode>
            options={MODES.map((m) => ({ value: m, label: t(COPY[m].name), icon: <RouteGlyph kind={m} /> }))}
            value={mode}
            onChange={pick}
            label={t('relay.title')}
            hug
            hue={hueIndex}
          />
          {/* Where the state does not fit beside the picker, it goes under it at the end of the row. */}
          <span data-testid="relay-state" className="ms-auto flex">
            {state}
          </span>
        </div>

        <div className="grid grid-cols-1 items-start gap-x-10 gap-y-5 lg:grid-cols-2" data-mode={mode}>
          <div className="flex min-w-0 flex-col gap-3.5">
            <Fact glyph={<RouteGlyph kind="relay" />}>
              {mode === 'project' ? t(copy.sentence, { host: hostOf(relay.projectRelayUrl) }) : t(copy.sentence)}
            </Fact>
            <Fact glyph={<FactGlyph kind="need" />}>
              <Lead>{t('relay.needLabel')}</Lead>
              {t(copy.need)}
            </Fact>
            {mode === 'own' && (
              <div className="flex flex-col gap-1" data-testid="own-relay">
                <FieldRow label={t('relay.address')}>
                  <Text value={address} onChange={type} mono label={t('relay.address')} placeholder="wss://relay.example.org" />
                </FieldRow>
                {addressError && <p className="text-end text-meta text-statusFail">{addressError}</p>}
              </div>
            )}
            {mode !== 'off' && (
              <Fact glyph={<FactGlyph kind="lock" />}>
                {t('relay.e2e')} <InfoBubble tip={t('relay.e2eTip')} />
              </Fact>
            )}
            {stage !== 'unpaired' && mode !== 'off' && !relay.connected && (
              <section className="flex flex-col gap-2 rounded-control bg-carbon-surface2 p-3.5 text-body text-carbon-textSub" data-testid="relay-check">
                <h3 className="glim-eyebrow">{t('pairing.relayCheckOpen')}</h3>
                <p>{t('pairing.relayCheckLead')}</p>
                <ul className="flex list-disc flex-col gap-1 ps-5">
                  <li>
                    {mode === 'project' ? (
                      <>
                        {beforeHost}
                        <span dir="ltr" className="font-mono text-carbon-text">
                          {hostOf(relay.projectRelayUrl)}
                        </span>
                        {afterHost}
                      </>
                    ) : (
                      t('pairing.relayCheckOwn')
                    )}
                  </li>
                  <li>{t('pairing.relayCheckFilter')}</li>
                </ul>
                <div className="flex justify-end">
                  <Button label={t('pairing.checkAgain')} labelKey="pairing.checkAgain" glyph={<IconRetry />} onClick={onRefresh} />
                </div>
              </section>
            )}
          </div>
          <RouteDiagram mode={mode} t={t} />
        </div>
      </div>

      {mode !== 'off' && (
        <CardFoot>
          <Button label={t('relay.seesTitle')} labelKey="relay.seesTitle" glyph={<IconEye />} onClick={() => setSeesOpen(true)} />
        </CardFoot>
      )}

      {seesOpen && (
        <Dialog
          title={t('relay.seesTitle')}
          hueIndex={hueIndex}
          onClose={() => setSeesOpen(false)}
          footer={<Button label={t('common.close')} labelKey="common.close" glyph={<IconClose />} tone="accent" onClick={() => setSeesOpen(false)} />}
        >
          <div className="flex flex-col gap-3">
            <Fact glyph={<FactGlyph kind="sees" />}>
              <Lead>{t('relay.seesLabel')}</Lead>
              {t('relay.sees')}
            </Fact>
            <Fact glyph={<FactGlyph kind="hidden" />}>
              <Lead>{t('relay.notSeesLabel')}</Lead>
              {t('relay.notSees')}
            </Fact>
          </div>
        </Dialog>
      )}
    </Card>
  )
}
