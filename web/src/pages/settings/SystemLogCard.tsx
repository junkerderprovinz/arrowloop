import { useEffect, useState } from 'react'

import { api, type SystemLine } from '../../lib/api'
import { dayTime } from '../../lib/dayTime'
import { errorText } from '../../lib/errorText'
import { Badge } from '../../lib/glimstone/Badge'
import { Card } from '../../lib/glimstone/Card'
import { useT, type TranslationKey } from '../../lib/i18n'
import { Reading } from './engineSettings'

const SOURCE: Record<SystemLine['Source'], TranslationKey> = {
  rclone: 'systemLog.rclone',
  connection: 'systemLog.connection',
  integration: 'systemLog.integration',
}

/** The errors from rclone, the connections and the integrations, newest first. */
export function SystemLogCard({ hueIndex }: { hueIndex: number }) {
  const { t, locale } = useT()
  const [lines, setLines] = useState<SystemLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    api.systemLog().then(
      (got) => current && setLines(got),
      (e: unknown) => current && setError(errorText(t, e)),
    )
    return () => {
      current = false
    }
  }, [t])

  if (!lines) return <Reading title={t('systemLog.title')} error={error} hueIndex={hueIndex} />

  return (
    <Card title={t('systemLog.title')} hint={t('systemLog.hint')} hueIndex={hueIndex}>
      {lines.length === 0 ? (
        <p className="text-subline text-carbon-textMuted">{t('systemLog.empty')}</p>
      ) : (
        <ul
          className="flex max-h-96 flex-col divide-y divide-carbon-border/60 overflow-y-auto"
          aria-label={t('systemLog.title')}
          // A list that scrolls on its own has to be reachable without a mouse.
          tabIndex={0}
        >
          {lines.map((line) => (
            <li key={line.ID} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Badge tone="neutral">{t(SOURCE[line.Source])}</Badge>
                <span className="glim-num text-subline text-carbon-textSub" title={new Date(line.At).toLocaleString(locale)}>
                  {dayTime(line.At, locale, (p) => t('list.when', p))}
                </span>
                {line.Count > 1 && (
                  <Badge tone="warn" className="tabular-nums">
                    {line.Count}&times;
                  </Badge>
                )}
              </span>
              <span className="text-subline text-carbon-text [overflow-wrap:anywhere]">{line.Text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
