import { runStrip, type RunTone } from '../lib/jobList'
import { useT } from '../lib/i18n'
import type { Run } from '../lib/api'

const TONE: Record<RunTone, string> = {
  ok: 'bg-statusOkSolid',
  warn: 'bg-statusWarnSolid',
  fail: 'bg-statusFailSolid',
  none: 'bg-carbon-surface3',
}

/**
 * A job's last fourteen runs as small squares, oldest first: green worked,
 * orange left something for a person, red failed, grey did not happen. One
 * sentence counts them for a screen reader and the hover bubble.
 */
export function RunStrip({ recent }: { recent: Run[] }) {
  const { t } = useT()
  const tones = runStrip(recent)
  const count = (tone: RunTone) => tones.filter((x) => x === tone).length
  const parts = [
    count('ok') > 0 && t('jobs.strip.ok', { count: count('ok') }),
    count('warn') > 0 && t('jobs.strip.warn', { count: count('warn') }),
    count('fail') > 0 && t('jobs.strip.fail', { count: count('fail') }),
  ].filter(Boolean)
  const label = parts.length > 0 ? `${t('jobs.strip.title')}: ${parts.join(', ')}` : t('jobs.strip.none')
  return (
    <span role="img" aria-label={label} data-tip={label} className="grid flex-none grid-cols-[repeat(14,8px)] gap-0.5">
      {tones.map((tone, i) => (
        <i key={i} className={`h-2 w-2 rounded-[2px] ${TONE[tone]}`} />
      ))}
    </span>
  )
}
