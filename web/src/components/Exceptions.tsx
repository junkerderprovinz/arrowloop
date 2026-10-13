import { useEffect, useState } from 'react'

import { IconRefresh } from './glyphs'
import { api, type RawJob } from '../lib/api'
import { errorText } from '../lib/errorText'
import { SETTING_LABEL, describeOwn, exceptionsOf, inheritAll, type Exception, type Inherited } from '../lib/follows'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { useT } from '../lib/i18n'
import { Link } from '../lib/router'
import { useToast } from '../lib/toast'

/**
 * The jobs that hold a value of their own for any of `settings`, and the way
 * one of them goes back to the defaults. A page asks for them itself, so it
 * knows whether the card stands and can count its cards' hues.
 */
export function useExceptions(settings: Inherited[]) {
  const { t } = useT()
  const push = useToast()
  const [jobs, setJobs] = useState<RawJob[]>([])
  const [shake, setShake] = useState<Record<string, number>>({})

  useEffect(() => {
    api
      .config()
      .then((c) => setJobs(c.jobs))
      .catch(() => setJobs([]))
  }, [])

  // The file is read again first, so a job changed in another window since
  // this page loaded keeps that change.
  async function inherit(exception: Exception) {
    try {
      const { jobs: file } = await api.config()
      const next = file.map((j) => (j.name === exception.name ? { ...j, ...(inheritAll(exception.own) as RawJob) } : j))
      setJobs((await api.saveConfig(next)).jobs)
    } catch (e) {
      push(errorText(t, e), 'fail')
      setShake((was) => ({ ...was, [exception.name]: (was[exception.name] ?? 0) + 1 }))
    }
  }

  return { jobs, list: exceptionsOf(jobs, settings), inherit, shake }
}

/**
 * The card that lists the exceptions, each with its own values and Use the
 * default. The page leaves it out while every job follows the defaults
 * (GlimStone, "Defaults and exceptions").
 */
export function ExceptionsCard({
  exceptions: { jobs, list, inherit, shake },
  hueIndex,
}: {
  exceptions: ReturnType<typeof useExceptions>
  hueIndex: number
}) {
  const { t } = useT()
  const [asking, setAsking] = useState<Exception | null>(null)

  return (
    <div data-new="exceptions">
      <Card title={t('defaults.exceptions')} hint={t('defaults.exceptionsHint')} hueIndex={hueIndex}>
        <ul className="flex flex-col divide-y divide-carbon-border/60">
          {list.map((exception) => {
            const job = jobs.find((j) => j.name === exception.name) ?? {}
            return (
              <li
                key={exception.name}
                data-exception={exception.name}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <span className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
                  <Link
                    to={`/jobs/${encodeURIComponent(exception.name)}`}
                    className="min-w-0 break-words text-body text-carbon-text hover:underline"
                  >
                    {exception.name}
                  </Link>
                  <span className="break-words text-subline text-carbon-textMuted">
                    {exception.own.map((setting) => describeOwn(job, setting, t)).join(' · ')}
                  </span>
                </span>
                <Button
                  key={shake[exception.name] ?? 0}
                  label={t('defaults.useDefault')}
                  labelKey="defaults.useDefault"
                  glyph={<IconRefresh />}
                  className={shake[exception.name] ? 'glim-shake' : ''}
                  onClick={() => setAsking(exception)}
                />
              </li>
            )
          })}
        </ul>
      </Card>
      {asking && (
        <ConfirmDialog
          title={t('defaults.askTitle')}
          message={t('defaults.askAll', {
            name: asking.name,
            list: asking.own.map((setting) => t(SETTING_LABEL[setting])).join(', '),
          })}
          confirmLabel={t('defaults.useDefault')}
          confirmLabelKey="defaults.useDefault"
          confirmGlyph={<IconRefresh />}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const chosen = asking
            setAsking(null)
            void inherit(chosen)
          }}
        />
      )}
    </div>
  )
}
