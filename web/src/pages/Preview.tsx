import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { Empty, Num, Rows, Rule } from '../components/Shell'
import { SelectionMark } from '../components/SelectionMark'
import { IconPlay } from '../components/glyphs'
import { Card } from '../lib/glimstone/Card'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { IconAction } from '../components/IconAction'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { Selector } from '../components/Selector'
import { actionName } from '../lib/actionName'
import { dayTime } from '../lib/dayTime'
import { api, type Action, type ActionKind, type Plan, type Resolution, type Shown, type SideVersion } from '../lib/api'
import { translateSide, useReason, useT, type TranslationKey } from '../lib/i18n'

/** A job's plan as a page of its own, for a shell that opens it there. */
export function Preview({ job, onDone }: { job: string; onDone: () => void }) {
  const { t } = useT()
  return (
    <Card title={t('preview.for', { job })} hueIndex={0}>
      <PreviewPlan job={job} onDone={onDone} />
    </Card>
  )
}

/**
 * A job's plan before anything moves: each proposed change with its direction
 * and the engine's reason, each one picked to start with and each one can be
 * left out, and nothing runs until the button is pressed.
 */
export function PreviewPlan({ job, onDone }: { job: string; onDone: () => void }) {
  const { t } = useT()
  const reason = useReason()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [busy, setBusy] = useState(false)

  const root = useRef<HTMLDivElement>(null)

  // The button that opened the plan is gone once it shows, which leaves the
  // focus nowhere, and Escape needs it in here.
  useEffect(() => {
    if (document.activeElement === document.body) root.current?.focus({ preventScroll: true })
  }, [])

  // Escape leaves while the focus is in the plan, except while a run is
  // starting or a bubble, list or window above takes the key for itself.
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || busy) return
    if (document.querySelector('[role="tooltip"], [role="dialog"], [role="menu"], [role="listbox"]')) return
    onDone()
  }
  const wrap = (children: ReactNode) => (
    <div ref={root} tabIndex={-1} onKeyDown={onKeyDown} className="flex flex-col gap-4 outline-none">
      {children}
    </div>
  )

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
  const ticked = useMemo(() => everything.filter((a) => !unticked.has(a.path)), [everything, unticked])
  const chosen = useMemo(() => ticked.map((a) => a.path), [ticked])

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
      // An explicit list even when everything is ticked. The engine plans
      // afresh and holds each path to what its row showed, so a file that
      // changed in the meantime is left for the next run rather than done
      // differently.
      const shown: Record<string, Shown> = {}
      for (const a of ticked) shown[a.path] = { kind: a.kind, from: a.from, to: a.to }
      await api.run(job, chosen, resolutions, shown)
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
    return wrap(
      <>
        {back}
        <p className="text-subline text-statusFail">{error}</p>
      </>,
    )
  }
  if (!plan) {
    return wrap(
      <>
        {back}
        <Empty>{t('preview.working')}</Empty>
      </>,
    )
  }

  const nothingToDo = everything.length === 0

  return wrap(
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {back}
        <Button
          label={
            busy
              ? t('preview.starting')
              : t('preview.run', { chosen: chosen.length, total: everything.length })
          }
          labelKey={busy ? 'preview.starting' : 'preview.run'}
          glyph={<IconPlay />}
          busy={busy}
          onClick={() => void start()}
          disabled={busy || nothingToDo || chosen.length === 0}
        />
      </div>
      {nothingToDo ? (
        <Empty>{t('preview.nothing')}</Empty>
      ) : (
        <>
          <p className="mb-2 flex items-center gap-1.5 text-subline text-carbon-textMuted">
            {t('preview.explain')}
          </p>
          <Rows className="glim-selecting flex flex-col">
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
      <p className="text-subline text-carbon-textMuted">
        {t('preview.unchanged', { count: plan.unchanged })}
        {plan.agreed > 0 && <> {' · '} {t('preview.identical', { count: plan.agreed })}</>}
      </p>
      {plan.skipped.length > 0 && (
        <section className="glim-well flex flex-col gap-2 rounded-card p-4">
          <h3 className="glim-eyebrow">{t('preview.skipped')}</h3>
          <ul className="flex flex-col gap-2">
            {plan.skipped.map((s) => (
              <li key={s.path} className="text-subline">
                <span className="font-medium">{s.path}</span>
                <span className="text-carbon-textMuted">, {reason(s.reason)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>,
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
      <div className="flex items-center gap-3">
        <SelectionMark checked={ticked} onPick={onToggle} label={t('job.pick', { path: actionName(action) })} />

        <Badge tone={tone[action.kind] ?? 'neutral'}>{t(kindKey[action.kind])}</Badge>

        <span className={`min-w-0 flex-1 truncate text-subline ${ticked ? '' : 'opacity-50'}`} title={actionName(action)}>
          {actionName(action)}
        </span>

        <span className="hidden shrink-0 text-subline text-carbon-textMuted sm:inline">{label}</span>
        <span className="shrink-0 text-subline text-carbon-textMuted">{reason(action.reason)}</span>
      </div>

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

/** One side's version of a file both sides changed, as the preview and the conflicts tab show it. */
export function Version({ side, version, newer }: { side: string; version?: SideVersion; newer: boolean }) {
  const { t, lang } = useT()
  if (!version) {
    return (
      <div className="bg-carbon-surface2 px-3 py-2 text-subline text-carbon-textMuted" style={{ borderRadius: 'var(--radius-control)' }}>
        {side}: {t('conflict.missing')}
      </div>
    )
  }
  return (
    <div className="bg-carbon-surface2 px-3 py-2" style={{ borderRadius: 'var(--radius-control)' }}>
      <div className="flex items-center gap-2">
        <span className="text-meta font-medium uppercase tracking-wider text-carbon-textMuted">{side}</span>
        {newer && <Badge tone="ok">{t('conflict.newer')}</Badge>}
      </div>
      <p className="mt-1 truncate font-mono text-subline" title={version.path}>
        {version.path}
      </p>
      <p className="mt-0.5 text-subline text-carbon-textMuted">
        {t('conflict.size')}: <Num>{bytes(version.size)}</Num>
        {' · '}
        {t('conflict.changed')}: <Num>{dayTime(version.mod, lang, (p) => t('list.when', p))}</Num>
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
