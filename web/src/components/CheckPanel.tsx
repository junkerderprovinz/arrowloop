import { useState } from 'react'

import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { IconCheck } from './glyphs'
import { api, type CheckFinding, type VerifyFinding } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * The two questions somebody asks about a job they are not sure about.
 *
 * "Can it even work" (both sides there, writable, room, record readable) and
 * "do the two sides actually match what the record says". They sit together
 * because they are asked together, by somebody who has just been surprised by
 * something, and splitting them across two places would mean finding out which
 * of the two they wanted.
 *
 * The findings are rendered from the server's OWN sentence rather than from a
 * translation of its code. Both packages ship a worded `text` beside the code
 * for exactly this, and the alternative was worse: forty-two translations of
 * twenty codes, written before anybody has seen one of them on screen, ageing
 * out of step with the engine that produces them. The codes are in the payload,
 * so a locale can take any of them over later, one at a time, and the sentence
 * stays as the fallback for the rest.
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
      // Health first and consistency second, because the second cannot say
      // anything useful when the first has already found that a side is not
      // there: it would list every file as missing and bury the one fact that
      // matters.
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
              // Invisible means no future run will notice this by itself,
              // which is the one class of problem that never fixes itself and
              // never announces itself.
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
          // A refused consistency check is a real answer and not a crash: the
          // record does not exist yet, or a side listed nothing. Shown as a
          // row rather than swallowed.
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
          labelKey={null}
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
