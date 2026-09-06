import { useEffect, useMemo, useState } from 'react'

import { Empty, Num, Rule, Stack } from '../components/Shell'
import { Card } from '../lib/glimstone/Card'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { Selector } from '../components/Selector'
import { api, type Action, type ActionKind, type Plan, type Resolution, type SideVersion } from '../lib/api'
import { translateSide, useReason, useT, type TranslationKey } from '../lib/i18n'

/**
 * The preview is the screen this whole product exists for.
 *
 * Every other sync tool's main view is a progress bar, which is a report on a
 * decision somebody already made on your behalf. Here the decision is yours:
 * each proposed change is listed with its direction and the reason the engine
 * gives for it, each one can be unticked, and nothing moves until the button is
 * pressed. A two-way sync that acts before the plan has been read is asking for
 * trust it has not earned.
 */
export function Preview({ job, onDone }: { job: string; onDone: () => void }) {
  const { t } = useT()
  const reason = useReason()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setPlan(null)
    setError(null)
    setUnticked(new Set())
    setResolutions({})
    api
      .plan(job)
      .then((p) => live && setPlan(p))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [job])

  const everything = useMemo(() => (plan ? [...plan.actions, ...plan.dirs] : []), [plan])
  const chosen = useMemo(
    () => everything.filter((a) => !unticked.has(a.path)).map((a) => a.path),
    [everything, unticked],
  )

  function toggle(path: string) {
    setUnticked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function start() {
    setBusy(true)
    try {
      // The full selection is sent as an explicit list rather than as "no
      // filter", so what runs is exactly what was on screen. Sending nothing
      // would run whatever the plan looks like at that moment, including rows
      // the person never saw.
      await api.run(job, chosen, resolutions)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <Card title={t('preview.title')} hueIndex={0}>
        <p className="text-[12px] text-statusFail">{error}</p>
      </Card>
    )
  }
  if (!plan) {
    return (
      <Card title={t('preview.title')} hueIndex={0}>
        <Empty>{t('preview.working')}</Empty>
      </Card>
    )
  }

  const nothingToDo = everything.length === 0

  return (
    <Stack>
      <Card
        title={t('preview.for', { job })}
        hueIndex={0}
      >
        {/* The one thing somebody came to this card to do, at the top of its
            body. GlimStone's Card draws a heading and nothing else, so a card's
            own controls live in the body, the same as in BombVault. */}
        <div className="flex justify-end">
          <Button
            label={
              busy
                ? t('preview.starting')
                : t('preview.run', { chosen: chosen.length, total: everything.length })
            }
            labelKey={null}
            tone="accent"
            busy={busy}
            onClick={() => void start()}
            disabled={busy || nothingToDo || chosen.length === 0}
          />
        </div>
        {nothingToDo ? (
          <Empty>{t('preview.nothing')}</Empty>
        ) : (
          <>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] text-carbon-textMuted">
              {t('preview.explain')}
            </p>
            <ul className="flex flex-col">
              {everything.map((a, i) => (
                <li key={`${a.kind}:${a.path}`}>
                  {i > 0 && <Rule />}
                  <Row
                    action={a}
                    ticked={!unticked.has(a.path)}
                    onToggle={() => toggle(a.path)}
                    resolution={resolutions[a.path] ?? 'both'}
                    onResolve={(next) => setResolutions((prev) => ({ ...prev, [a.path]: next }))}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 text-[11px] text-carbon-textMuted">
          {t('preview.unchanged', { count: plan.unchanged })}
          {plan.agreed > 0 && <> {' · '} {t('preview.identical', { count: plan.agreed })}</>}
        </p>
      </Card>

      {plan.skipped.length > 0 && (
        <Card title={t('preview.skipped')} hueIndex={1}>
          <ul className="flex flex-col gap-2">
            {plan.skipped.map((s) => (
              <li key={s.path} className="text-[12px]">
                <span className="font-medium">{s.path}</span>
                <span className="text-carbon-textMuted">, {reason(s.reason)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Stack>
  )
}

/**
 * A proposed change has not happened yet, so it is waiting, and waiting is the
 * neutral hue. The accent is reserved for activity, which on this page is the
 * one Run button and nothing else. The two kinds that remove something keep the
 * fault hue, because a row that is about to take a file away should not look
 * the same as one that is about to add one.
 */
const tone = {
  copy: 'neutral',
  move: 'neutral',
  mkdir: 'neutral',
  conflict: 'fail',
  delete: 'fail',
  rmdir: 'fail',
} as const

const kindKey: Record<ActionKind, TranslationKey> = {
  copy: 'kind.copy',
  move: 'kind.move',
  delete: 'kind.delete',
  conflict: 'kind.conflict',
  mkdir: 'kind.mkdir',
  rmdir: 'kind.rmdir',
}

function Row({
  action,
  ticked,
  onToggle,
  resolution,
  onResolve,
}: {
  action: Action
  ticked: boolean
  onToggle: () => void
  resolution: Resolution
  onResolve: (next: Resolution) => void
}) {
  const { t } = useT()
  const reason = useReason()
  // A copy names two sides and a move names two paths, so only the first pair
  // goes through the side translation. A path is a path in every language.
  const label =
    action.kind === 'copy'
      ? `${translateSide(t, action.from ?? '')} → ${translateSide(t, action.to ?? '')}`
      : action.kind === 'move'
        ? `${action.from} → ${action.to}`
        : translateSide(t, action.to ?? '')

  return (
    <div className="py-2.5">
      <label className="flex cursor-pointer items-center gap-3">
        {/* A switch rather than a checkbox: the design language never uses a
            checkbox, and this is the one control on the page whose state
            decides whether a file is touched at all. */}
        <span
          role="switch"
          aria-checked={ticked}
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              onToggle()
            }
          }}
          // De-coloured on purpose. Every row arrives ticked, so a switch that
          // is on in all of them is not marking activity, and the accent means
          // activity or it means nothing.
          className={`inline-flex h-4 w-7 shrink-0 items-center p-0.5 transition-colors ${
            ticked ? 'bg-carbon-text' : 'bg-carbon-surface3'
          }`}
          style={{ borderRadius: 'var(--radius-pill)' }}
        >
          <span
            className={`h-3 w-3 bg-carbon-background transition-transform ${ticked ? 'translate-x-3' : ''}`}
            style={{ borderRadius: 'var(--radius-pill)' }}
          />
        </span>

        <Badge tone={tone[action.kind] ?? 'neutral'}>{t(kindKey[action.kind])}</Badge>

        <span className={`min-w-0 flex-1 truncate text-[12px] ${ticked ? '' : 'opacity-50'}`} title={action.path}>
          {action.path}
        </span>

        <span className="hidden shrink-0 text-[11px] text-carbon-textMuted sm:inline">{label}</span>
        <span className="shrink-0 text-[11px] text-carbon-textMuted">{reason(action.reason)}</span>
      </label>

      {action.kind === 'conflict' && ticked && (
        <Conflict action={action} resolution={resolution} onResolve={onResolve} />
      )}
    </div>
  )
}

/**
 * The two versions, side by side, and what to do with them.
 *
 * A conflict row that only says "conflict" asks somebody to go and look at two
 * files themselves before they can answer the question the screen just put to
 * them. The size and the time are the two facts that settle it in almost every
 * case, so they belong here rather than in a file manager.
 */
function Conflict({
  action,
  resolution,
  onResolve,
}: {
  action: Action
  resolution: Resolution
  onResolve: (next: Resolution) => void
}) {
  const { t } = useT()
  const leftNewer =
    action.left && action.right ? new Date(action.left.mod) > new Date(action.right.mod) : false

  return (
    <div className="ml-[2.6rem] mt-2 flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Version side={t('side.left')} version={action.left} newer={leftNewer} />
        <Version side={t('side.right')} version={action.right} newer={!leftNewer && !!action.right} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Selector<Resolution>
          scale="small"
          label={t('conflict.title')}
          value={resolution}
          onChange={onResolve}
          options={[
            { value: 'both', label: t('conflict.keepBoth') },
            { value: 'left', label: t('conflict.keepLeft') },
            { value: 'right', label: t('conflict.keepRight') },
          ]}
        />
        <InfoBubble tip={resolution === 'both' ? t('conflict.keepBothHint') : t('conflict.chosenHint')} />
      </div>
    </div>
  )
}

function Version({ side, version, newer }: { side: string; version?: SideVersion; newer: boolean }) {
  const { t } = useT()
  if (!version) {
    return (
      <div className="bg-carbon-surface2 px-3 py-2 text-[11px] text-carbon-textMuted" style={{ borderRadius: 'var(--radius-control)' }}>
        {side}: {t('conflict.missing')}
      </div>
    )
  }
  return (
    <div className="bg-carbon-surface2 px-3 py-2" style={{ borderRadius: 'var(--radius-control)' }}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-carbon-textMuted">{side}</span>
        {newer && <Badge tone="ok">{t('conflict.newer')}</Badge>}
      </div>
      <p className="mt-1 truncate font-mono text-[11px]" title={version.path}>
        {version.path}
      </p>
      <p className="mt-0.5 text-[11px] text-carbon-textMuted">
        {t('conflict.size')}: <Num>{bytes(version.size)}</Num>
        {' · '}
        {t('conflict.changed')}: <Num>{new Date(version.mod).toLocaleString()}</Num>
      </p>
    </div>
  )
}

/** A size a person can read. Binary steps, because that is what a file manager
 *  on every one of these platforms shows next to the same file. */
function bytes(n: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = n
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}
