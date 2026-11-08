import { useState } from 'react'

import { ConfirmWindow } from '../../../components/ConfirmWindow'
import { IconApp, IconClose, IconConfirm, IconKeyRevoke, IconPhone, IconServer } from '../../../components/glyphs'
import { api, type ConnectInfo, type Deployment } from '../../../lib/api'
import { Badge, type BadgeTone } from '../../../lib/glimstone/Badge'
import { Button } from '../../../lib/glimstone/Button'
import { Card } from '../../../lib/glimstone/Card'
import { InfoBubble } from '../../../lib/glimstone/InfoBubble'
import { useT, type TranslationKey } from '../../../lib/i18n'
import { kindName, refusalText, seenAgo, type PairStage } from '../../../lib/pairing'
import { useToast } from '../../../lib/toast'
import { Mark, Row, Rows, WaitRow } from './parts'

/** The badge each stage shows on this instance's row once there is a group. */
const STAGE_BADGE: Record<Exclude<PairStage, 'unpaired' | 'paired'>, { tone: BadgeTone; key: TranslationKey }> = {
  new: { tone: 'active', key: 'pairing.stateNew' },
  searching: { tone: 'neutral', key: 'pairing.stateSearching' },
  gone: { tone: 'neutral', key: 'pairing.stateSearching' },
  alone: { tone: 'warn', key: 'pairing.stateAlone' },
}

function glyphFor(deployment: Deployment) {
  if (deployment === 'phone') return <IconPhone />
  if (deployment === 'desktop') return <IconApp />
  return <IconServer />
}

/** Paired is a state and nothing to press, so it is a dot and a word. */
function Approved({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-subline text-carbon-textSub">
      <i aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full bg-statusOkSolid" />
      {label}
    </span>
  )
}

/**
 * Who is in the group: the instances that wait for approval, this instance
 * with where it stands, the others that are there and the approved ones that
 * are away, each with the button that takes it out.
 */
export function GroupCard({ group, stage, joinedAgo, hueIndex, onRefresh }: {
  group: ConnectInfo
  stage: PairStage
  joinedAgo: number
  hueIndex: number
  onRefresh: () => void
}) {
  const { t, lang } = useT()
  const push = useToast()
  const [busy, setBusy] = useState(false)
  const [asked, setAsked] = useState<{ kind: 'refuse' | 'remove'; id: string; name: string } | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
      onRefresh()
    } catch (e) {
      push(refusalText(t, e), 'fail')
    } finally {
      setBusy(false)
    }
  }

  const shownName = (n: string) => n || t('pairing.thisInstance')
  const remove = (id: string, name: string) => (
    <Button
      label={t('pairing.remove')}
      labelKey="pairing.remove"
      glyph={<IconKeyRevoke />}
      disabled={busy}
      onClick={() => setAsked({ kind: 'remove', id, name })}
    />
  )
  const badge = stage !== 'unpaired' && stage !== 'paired' ? STAGE_BADGE[stage] : null

  return (
    <Card title={t('nav.instances')} hint={t('pairing.groupHint')} hueIndex={hueIndex}>
      <div className="flex min-w-0 flex-col gap-4" data-stage={stage}>
        {group.awaiting && (
          <p role="status" className="rounded-control bg-statusWarnBgSoft px-3 py-2.5 text-subline text-carbon-text">
            {t('pairing.awaiting')}
          </p>
        )}

        {group.pending.length > 0 && (
          <section className="glim-subcard flex flex-col gap-3 px-4 pb-4 pt-3" aria-label={t('pairing.pendingTitle')}>
            <h3 className="glim-eyebrow flex items-center gap-1.5 font-semibold">
              {t('pairing.pendingTitle')}
              <InfoBubble tip={t('pairing.pendingTip')} />
            </h3>
            <Rows>
              {group.pending.map((p) => (
                <Row key={p.id} glyph={<IconServer />} name={shownName(p.name)} note={t('pairing.fingerprint', { fingerprint: p.fingerprint })}>
                  <Button
                    label={t('pairing.refuse')}
                    labelKey="pairing.refuse"
                    glyph={<IconClose />}
                    disabled={busy}
                    onClick={() => setAsked({ kind: 'refuse', id: p.id, name: shownName(p.name) })}
                  />
                  <Button
                    label={t('pairing.approve')}
                    labelKey="pairing.approve"
                    glyph={<IconConfirm />}
                    tone="accent"
                    disabled={busy}
                    onClick={() => void run(() => api.approveMember(p.id))}
                  />
                </Row>
              ))}
            </Rows>
          </section>
        )}

        <div className="flex min-w-0 flex-col gap-2">
          <Rows>
            <Row glyph={glyphFor(group.deployment)} name={shownName(group.name)}>
              <Mark>{t('pairing.thisInstance')}</Mark>
              {stage === 'paired' && <Approved label={t('pairing.paired')} />}
              {badge && (
                <span data-testid="pair-state" className="flex">
                  <Badge tone={badge.tone}>{t(badge.key)}</Badge>
                </span>
              )}
            </Row>
            {group.members.map((m) => (
              <Row key={m.id} glyph={glyphFor(m.deployment)} name={m.name || m.id}>
                {kindName(t, m.deployment) && <Mark>{kindName(t, m.deployment)}</Mark>}
                {m.approved ? <Approved label={t('pairing.approved')} /> : <Badge tone="warn">{t('pairing.pendingTitle')}</Badge>}
                {remove(m.id, m.name)}
              </Row>
            ))}
            {group.away.map((m) => (
              <Row
                key={m.id}
                glyph={glyphFor(m.deployment)}
                name={m.name || m.id}
                note={m.lastSeen > 0 ? t('pairing.lastSeen', { time: seenAgo(lang, m.lastSeen) }) : undefined}
              >
                {kindName(t, m.deployment) && <Mark>{kindName(t, m.deployment)}</Mark>}
                <Badge tone="neutral">{t('pairing.inactive')}</Badge>
                {remove(m.id, m.name)}
              </Row>
            ))}
          </Rows>
          {stage === 'new' ? (
            <WaitRow text={t('pairing.waitNext')} />
          ) : stage !== 'paired' && stage !== 'unpaired' ? (
            <WaitRow text={t('pairing.searching')} seconds={stage === 'searching' ? joinedAgo : undefined} />
          ) : null}
        </div>
      </div>

      {asked && (
        <ConfirmWindow
          title={asked.kind === 'refuse' ? t('pairing.refuseTitle', { name: asked.name }) : t('pairing.removeTitle', { name: asked.name })}
          message={asked.kind === 'refuse' ? t('pairing.refuseConfirm', { name: asked.name }) : t('pairing.removeConfirm', { name: asked.name })}
          confirmLabel={asked.kind === 'refuse' ? t('pairing.refuse') : t('pairing.remove')}
          confirmLabelKey={asked.kind === 'refuse' ? 'pairing.refuse' : 'pairing.remove'}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setAsked(null)}
          onConfirm={() => {
            const { kind, id } = asked
            setAsked(null)
            void run(() => (kind === 'refuse' ? api.refuseMember(id) : api.removeMember(id)))
          }}
        />
      )}
    </Card>
  )
}
