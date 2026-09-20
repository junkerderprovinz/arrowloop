import { useState } from 'react'

import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { IconCheck } from './glyphs'
import { api, type CheckFinding, type VerifyFinding } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * Checks whether a job can work at all and whether both sides match its record.
 *
 * Findings show the server's own sentence rather than a translation of their
 * code; the code is in the payload for a locale that wants to take one over.
 */

type Row = { key: string; text: string; bad: boolean }

export function CheckPanel({ job }: { job: string }) {
  const { t } = useT()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function look() {
    setBusy(true)
    setError(null)
    setRows(null)
    try {
      // With a side missing, the consistency check would list every file as
      // missing and bury the one finding that matters.
      const health = await api.checkJob(job)
      const out: Row[] = health.findings.map((f: CheckFinding, i: number) => ({
        key: `h${i}`,
        text: f.text,
        bad: f.fatal,
      }))

      if (health.ok) {
        try {
          const seen = await api.verifyJob(job)
          out.push(
            ...seen.findings.map((f: VerifyFinding, i: number) => ({
              key: `v${i}`,
              text: f.text,
              // No future run would notice an invisible finding by itself.
              bad: f.invisible,
            })),
          )
          if (seen.truncated) {
            out.push({
              key: 'more',
              text: t('check.more', { found: seen.found, shown: seen.returned }),
              bad: false,
            })
          }
        } catch (e) {
          // A refusal is an answer (no record yet, or a side listed nothing),
          // so it is shown as a row.
          out.push({ key: 'verr', text: (e as Error).message, bad: false })
        }
      }
      setRows(out)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button
          label={t('jobs.check')}
          labelKey="jobs.check"
          glyph={<IconCheck />}
          busy={busy}
          disabled={busy}
          onClick={() => void look()}
        />
      </div>

      {error && <p className="text-xs text-statusFail">{error}</p>}

      {rows !== null && rows.length === 0 && (
        <p className="text-xs text-statusOk">{t('check.healthy')}</p>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start gap-2 text-xs">
              <Badge tone={r.bad ? 'fail' : 'warn'}>{r.bad ? '!' : '?'}</Badge>
              <span className="min-w-0 flex-1 break-words text-carbon-text">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
