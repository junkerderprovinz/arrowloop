import { useEffect, useRef, useState } from 'react'

import { Dialog } from '../../../components/Dialog'
import { FieldRow, Text } from '../../../components/Field'
import { IconClose, IconEye, IconRetry } from '../../../components/glyphs'
import { Selector } from '../../../components/Selector'
import { ToggleRow } from '../../../components/ToggleRow'
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
import { FORMS, modeOf, relayForm, type RelayForm } from './relayForm'

const COPY: Record<RelayForm, { name: TranslationKey; sentence: TranslationKey; need: TranslationKey }> = {
  project: { name: 'relay.project', sentence: 'relay.projectSentence', need: 'relay.projectNeed' },
  own: { name: 'relay.own', sentence: 'relay.ownSentence', need: 'relay.ownNeed' },
  instance: { name: 'relay.instanceName', sentence: 'relay.instanceSub', need: 'relay.instanceNeed' },
  off: { name: 'relay.off', sentence: 'relay.offSentence', need: 'relay.offNeed' },
}

/** What the address field shows before anything is typed: a relay, or an instance reached from outside. */
const EXAMPLE: Partial<Record<RelayForm, string>> = {
  own: 'wss://relay.example.org',
  instance: 'https://arrowloop.example.org/relay/connect',
}

// An own relay without TLS still works on a LAN, but its relay key then
// travels in the clear, so the card says so.
const PLAINTEXT_RELAY = /^(ws|http):\/\//i

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
 * Which relay carries the group: the project's, one of the owner's own, an
 * ArrowLoop of the group that serves one, or none. Each route says in one
 * sentence what it is and what it needs, beside a picture of a message on its
 * way. Every control saves on its own.
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
  // Which of the two own routes was picked here. The engine stores one mode
  // for both, so without a pick the switch and the address decide.
  const [picked, setPicked] = useState<'own' | 'instance' | null>(null)
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

  function save(change: { mode?: RelayMode; serve?: boolean }, undo: () => void) {
    api
      .saveRelay(change)
      .then(onRelay)
      .catch((e: unknown) => {
        undo()
        push(refusalText(t, e), 'fail')
      })
  }

  const form: RelayForm = mode !== 'own' ? mode : (picked ?? relayForm({ ...relay, mode, relayUrl: address }))

  // Leaving the route on which this instance serves also stops it serving,
  // so no relay runs here that the card does not show.
  function pick(next: RelayForm) {
    const before = { mode, picked }
    const change: { mode?: RelayMode; serve?: boolean } = {}
    if (modeOf(next) !== mode) change.mode = modeOf(next)
    if (next !== 'instance' && relay.serve) change.serve = false
    setMode(modeOf(next))
    setPicked(next === 'own' || next === 'instance' ? next : null)
    if (Object.keys(change).length > 0) {
      save(change, () => {
        setMode(before.mode)
        setPicked(before.picked)
      })
    }
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

  const copy = COPY[form]
  const ownAddress = form === 'own' || form === 'instance'
  // The relay key comes from the twelve words, so the relay is only dialled
  // inside a group; before that there is nothing to be connected.
  const state =
    form === 'off' ? (
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
          <Selector<RelayForm>
            options={FORMS.map((f) => ({ value: f, label: t(COPY[f].name), icon: <RouteGlyph kind={f} /> }))}
            value={form}
            onChange={pick}
            label={t('relay.title')}
            hug
            oneRow
            hue={hueIndex}
          />
          {/* Where the state does not fit beside the picker, it goes under it at the end of the row. */}
          <span data-testid="relay-state" className="ms-auto flex">
            {state}
          </span>
        </div>

        <div className="grid grid-cols-1 items-start gap-x-10 gap-y-5 lg:grid-cols-2" data-form={form}>
          <div className="flex min-w-0 flex-col gap-3.5">
            <Fact glyph={<RouteGlyph kind="relay" />}>
              {form === 'project' ? t(copy.sentence, { host: hostOf(relay.projectRelayUrl) }) : t(copy.sentence)}
            </Fact>
            <Fact glyph={<FactGlyph kind="need" />}>
              <Lead>{t('relay.needLabel')}</Lead>
              {t(copy.need)}
            </Fact>
            {form === 'instance' && relay.canServe && (
              <div className="flex flex-col gap-1" data-testid="instance-relay">
                <ToggleRow
                  label={t('relay.serve')}
                  hint={t('relay.serveHint')}
                  checked={relay.serve}
                  onChange={(serve) => save({ serve }, () => {})}
                />
                {relay.serve && <p className="text-meta text-carbon-textMuted">{t('relay.serveClients', { count: relay.serveClients })}</p>}
              </div>
            )}
            {ownAddress && (
              <div className="flex flex-col gap-1" data-testid="own-relay">
                <FieldRow label={t('relay.address')}>
                  <Text value={address} onChange={type} mono label={t('relay.address')} placeholder={EXAMPLE[form]} />
                </FieldRow>
                {addressError && <p className="text-end text-meta text-statusFail">{addressError}</p>}
                {!addressError && PLAINTEXT_RELAY.test(address.trim()) && (
                  <p className="mt-2 rounded-control bg-statusWarnBg px-3 py-2.5 text-body leading-relaxed text-carbon-text">
                    {t('relay.plaintextWarning')}
                  </p>
                )}
              </div>
            )}
            {form === 'instance' && (
              <Fact glyph={<FactGlyph kind="shield" />}>
                {t('relay.instanceCert')} <InfoBubble tip={t('relay.instanceCertTip')} />
              </Fact>
            )}
            {form !== 'off' && (
              <Fact glyph={<FactGlyph kind="lock" />}>
                {t('relay.e2e')} <InfoBubble tip={t('relay.e2eTip')} />
              </Fact>
            )}
            {stage !== 'unpaired' && form !== 'off' && !relay.connected && (
              <section className="flex flex-col gap-2 rounded-control bg-carbon-surface2 p-3.5 text-body text-carbon-textSub" data-testid="relay-check">
                <h3 className="glim-eyebrow">{t('pairing.relayCheckOpen')}</h3>
                <p>{t('pairing.relayCheckLead')}</p>
                <ul className="flex list-disc flex-col gap-1 ps-5">
                  <li>
                    {form === 'project' ? (
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
          <RouteDiagram form={form} t={t} />
        </div>
      </div>

      {form !== 'off' && (
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
