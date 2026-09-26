import { useEffect, useMemo, useState } from 'react'

import { Empty, Num, Rows, Rule, Stack } from '../components/Shell'
import { Card } from '../lib/glimstone/Card'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { IconAction } from '../components/IconAction'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { Selector } from '../components/Selector'
import { actionName } from '../lib/actionName'
import { api, type Action, type ActionKind, type Plan, type Resolution, type SideVersion } from '../lib/api'
import { translateSide, useReason, useT, type TranslationKey } from '../lib/i18n'

/**
 * A job's plan before anything moves: each proposed change with its direction
 * and the engine's reason, each one untickable, and nothing runs until the
 * button is pressed.
 */
export function Preview({ job, onDone }: { job: string; onDone: () => void }) {
  const { t } = useT()
  const reason = useReason()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [busy, setBusy] = useState(false)

  // Escape leaves, except while a run is starting.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onDone])

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
      // An explicit list even when everything is ticked, so what runs is
      // exactly what was on screen rather than a fresh plan.
      await api.run(job, chosen, resolutions)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // The way back shows on every state of the page, the error and the wait too.
  const back = (
    <div className="flex justify-end">
      <IconAction
        title={t('preview.back')}
        labelKey="preview.back"
        hint={t('preview.backHint')}
        hueIndex={1}
        onClick={onDone}
      />
    </div>
  )

  if (error) {
    return (
      <Card title={t('preview.title')} hueIndex={0}>
        {back}
        <p className="text-xs text-statusFail">{error}</p>
      </Card>
    )
  }
  if (!plan) {
    return (
      <Card title={t('preview.title')} hueIndex={0}>
        {back}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          {back}
          <Button
            label={
              busy
                ? t('preview.starting')
                : t('preview.run', { chosen: chosen.length, total: everything.length })
            }
            labelKey={busy ? 'preview.starting' : 'preview.run'}
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
            <p className="mb-2 flex items-center gap-1.5 text-xs text-carbon-textMuted">
              {t('preview.explain')}
            </p>
            <Rows className="flex flex-col">
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
            </Rows>
          </>
        )}
        <p className="mt-4 text-xs text-carbon-textMuted">
          {t('preview.unchanged', { count: plan.unchanged })}
          {plan.agreed > 0 && <> {' · '} {t('preview.identical', { count: plan.agreed })}</>}
        </p>
      </Card>

      {plan.skipped.length > 0 && (
        <Card title={t('preview.skipped')} hueIndex={1}>
          <ul className="flex flex-col gap-2">
            {plan.skipped.map((s) => (
              <li key={s.path} className="text-xs">
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
 * A proposed change is waiting, so it takes the neutral hue; the accent is
 * for the Run button alone. Kinds that take something away wear the fault hue.
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
  // A copy names two sides, which are translated; a move names two paths.
  const label =
    action.kind === 'copy'
      ? `${translateSide(t, action.from ?? '')} → ${translateSide(t, action.to ?? '')}`
      : action.kind === 'move'
        ? `${action.from} → ${action.to}`
        : translateSide(t, action.to ?? '')

  return (
    <div className="py-2.5">
      <label className="flex cursor-pointer items-center gap-3">
        {/* A switch, since the design language never uses a checkbox. */}
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
          // Not the accent: every row arrives ticked, so "on" marks no activity.
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

        <span className={`min-w-0 flex-1 truncate text-xs ${ticked ? '' : 'opacity-50'}`} title={actionName(action)}>
          {actionName(action)}
        </span>

        <span className="hidden shrink-0 text-xs text-carbon-textMuted sm:inline">{label}</span>
        <span className="shrink-0 text-xs text-carbon-textMuted">{reason(action.reason)}</span>
      </label>

      {action.kind === 'conflict' && ticked && (
        <Conflict action={action} resolution={resolution} onResolve={onResolve} />
      )}
    </div>
  )
}

/**
 * The two versions side by side, with the size and time that settle most
 * conflicts, and the choice of what to keep.
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
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
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
        </div>
        <InfoBubble tip={resolution === 'both' ? t('conflict.keepBothHint') : t('conflict.chosenHint')} />
      </div>
    </div>
  )
}

function Version({ side, version, newer }: { side: string; version?: SideVersion; newer: boolean }) {
  const { t } = useT()
  if (!version) {
    return (
      <div className="bg-carbon-surface2 px-3 py-2 text-xs text-carbon-textMuted" style={{ borderRadius: 'var(--radius-control)' }}>
        {side}: {t('conflict.missing')}
      </div>
    )
  }
  return (
    <div className="bg-carbon-surface2 px-3 py-2" style={{ borderRadius: 'var(--radius-control)' }}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-carbon-textMuted">{side}</span>
        {newer && <Badge tone="ok">{t('conflict.newer')}</Badge>}
      </div>
      <p className="mt-1 truncate font-mono text-xs" title={version.path}>
        {version.path}
      </p>
      <p className="mt-0.5 text-xs text-carbon-textMuted">
        {t('conflict.size')}: <Num>{bytes(version.size)}</Num>
        {' · '}
        {t('conflict.changed')}: <Num>{new Date(version.mod).toLocaleString()}</Num>
      </p>
    </div>
  )
}

/** A readable size in binary steps, as file managers show it. */
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
