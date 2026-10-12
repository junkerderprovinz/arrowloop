import { Badge } from '../lib/glimstone/Badge'
import { Card } from '../lib/glimstone/Card'
import type { Finding } from '../lib/anomalies'
import { useGoTo, type Place } from '../lib/goTo'
import { useT, type TranslationKey } from '../lib/i18n'
import type { HeadState, Need } from '../lib/needs'

const HEAD: Record<HeadState, TranslationKey> = {
  inSync: 'status.inSync',
  withNotes: 'status.withNotes',
  needsYou: 'status.needsYou',
}

const DOT: Record<HeadState, string> = {
  inSync: 'bg-statusOkSolid',
  withNotes: 'bg-statusWarnSolid',
  needsYou: 'bg-statusFailSolid',
}

/**
 * The one sentence the jobs page opens with, from a fixed set, so a glance
 * says whether anything waits. A note is never rounded up to "in sync".
 */
export function StatusHead({ head }: { head: HeadState }) {
  const { t } = useT()
  return (
    <p data-testid="status-head" className="flex items-center gap-3 text-status font-semibold text-carbon-text">
      <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full ${DOT[head]}`} />
      {t(HEAD[head])}
    </p>
  )
}

/**
 * What waits for a person, each line leading to where it is answered. It is
 * only drawn while something waits, since the normal case is quiet.
 */
export function NeedsCard({ items, findings, hueIndex }: { items: Need[]; findings: Finding[]; hueIndex?: number }) {
  const { t } = useT()
  const goTo = useGoTo()
  if (items.length === 0) return null

  function line(need: Need): { text: string; count?: number; tone: 'warn' | 'fail'; place: Place } {
    switch (need.kind) {
      case 'conflicts':
        return { text: t('needs.conflicts'), count: need.count, tone: 'warn', place: { tab: 'conflicts', job: '' } }
      case 'held': {
        const finding = findings.find((f) => f.id === need.finding)
        const what = finding ? t(`anomaly.kind.${finding.kind}`) : ''
        return {
          text: t('needs.held', { job: need.job, what }),
          tone: 'fail',
          place: { tab: 'anomalies', job: need.job, finding: need.finding },
        }
      }
      case 'notes':
        return { text: t('needs.notes'), count: need.count, tone: 'warn', place: { tab: 'anomalies', job: '' } }
    }
  }

  return (
    <Card title={t('needs.title')} hueIndex={hueIndex}>
      <ul className="-my-1 flex flex-col">
        {items.map((need) => {
          const { text, count, tone, place } = line(need)
          return (
            <li key={need.kind === 'held' ? need.finding : need.kind}>
              <button
                type="button"
                onClick={() => goTo(place)}
                className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-control px-2 py-1.5 text-start hover:bg-carbon-hover"
              >
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${tone === 'fail' ? 'bg-statusFailSolid' : 'bg-statusWarnSolid'}`} />
                <span className="min-w-0 flex-1 text-body text-carbon-text [overflow-wrap:anywhere]">{text}</span>
                {count !== undefined && (
                  <Badge tone={tone} className="glim-num shrink-0">
                    {count}
                  </Badge>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
