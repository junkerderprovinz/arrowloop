import { useEffect, useMemo, useState } from 'react'

import { Badge, Button, Card, Empty, Num, Rule, Stack } from '../components/Shell'
import { api, type Action, type Plan } from '../lib/api'

/**
 * The preview is the screen this whole product exists for.
 *
 * Every other sync tool's main view is a progress bar, which is a report on a
 * decision somebody already made on your behalf. Here the decision is yours:
 * each proposed change is listed with its direction and the reason the engine
 * gives for it, each one can be unticked, and nothing moves until the button
 * is pressed. A two-way sync that acts before the plan has been read is asking
 * for trust it has not earned.
 */
export function Preview({ job, onDone }: { job: string; onDone: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setPlan(null)
    setError(null)
    setUnticked(new Set())
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
      await api.run(job, chosen)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <Card title="Preview">
        <p className="text-[12px] text-statusFail">{error}</p>
      </Card>
    )
  }
  if (!plan) {
    return (
      <Card title="Preview">
        <Empty>Working out what would happen. Nothing has been touched.</Empty>
      </Card>
    )
  }

  const nothingToDo = everything.length === 0

  return (
    <Stack>
      <Card
        title={`Preview: ${job}`}
        actions={
          <Button primary onClick={start} disabled={busy || nothingToDo || chosen.length === 0}>
            {busy ? 'Starting' : `Run ${chosen.length} of ${everything.length}`}
          </Button>
        }
      >
        {nothingToDo ? (
          <Empty>
            Both sides already agree on <Num>{plan.unchanged}</Num> files. There is nothing to do.
          </Empty>
        ) : (
          <ul className="flex flex-col">
            {everything.map((a, i) => (
              <li key={`${a.kind}:${a.path}`}>
                {i > 0 && <Rule />}
                <Row action={a} ticked={!unticked.has(a.path)} onToggle={() => toggle(a.path)} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[11px] text-carbon-textMuted">
          <Num>{plan.unchanged}</Num> unchanged
          {plan.agreed > 0 && (
            <>
              {' · '}
              <Num>{plan.agreed}</Num> already identical on both sides
            </>
          )}
        </p>
      </Card>

      {plan.skipped.length > 0 && (
        <Card title="Left for later">
          <ul className="flex flex-col gap-2">
            {plan.skipped.map((s) => (
              <li key={s.path} className="text-[12px]">
                <span className="font-medium">{s.path}</span>
                <span className="text-carbon-textMuted"> — {s.reason}</span>
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

function Row({ action, ticked, onToggle }: { action: Action; ticked: boolean; onToggle: () => void }) {
  const label =
    action.kind === 'copy'
      ? `${action.from} to ${action.to}`
      : action.kind === 'move'
        ? `${action.from} to ${action.to}`
        : action.to ?? ''

  return (
    <label className="flex cursor-pointer items-center gap-3 py-2.5">
      {/* A switch rather than a checkbox: the design language never uses a
          checkbox, and this is the one control on the page whose state decides
          whether a file is touched at all. */}
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
        // De-coloured on purpose. Every row arrives ticked, so a switch that is
        // on in all of them is not marking activity, and the accent means
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

      <Badge tone={tone[action.kind] ?? 'neutral'}>{action.kind}</Badge>

      <span className={`min-w-0 flex-1 truncate text-[12px] ${ticked ? '' : 'opacity-50'}`} title={action.path}>
        {action.path}
      </span>

      <span className="hidden shrink-0 text-[11px] text-carbon-textMuted sm:inline">{label}</span>
      <span className="shrink-0 text-[11px] text-carbon-textMuted">{action.reason}</span>
    </label>
  )
}
