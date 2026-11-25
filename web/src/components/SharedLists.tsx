import { useEffect, useMemo, useState } from 'react'
import { componentText } from '@glimstone/core'
import { MultiSelect } from '@glimstone/react/MultiSelect'

import { ConfirmWindow } from './ConfirmWindow'
import { Dialog } from './Dialog'
import { Lines, Text } from './Field'
import { IconAdd, IconTrash } from './glyphs'
import { IconAction } from './IconAction'
import { api, type RawJob } from '../lib/api'
import { Button } from '../lib/glimstone/Button'
import { errorText } from '../lib/errorText'
import { useHost, type SharedLists } from '../lib/host'
import { useT } from '../lib/i18n'
import { addList, handOver, jobsUsing, offered, setSide, stranded, type SetChoice, type Way } from '../lib/sharedLists'

/**
 * Shared lists, written once in the settings and named by jobs, each of which
 * includes or excludes a list.
 *
 * The loader refuses a job that names an undefined list, because a filter that
 * silently matches nothing syncs exactly what somebody asked to leave alone.
 */

export type Sets = Record<string, string[]>

type Choice = SetChoice & { include?: string[]; exclude?: string[] }

/** The editor, for the settings page and the window the job form opens. */
export function SharedListEditor({
  sets,
  onChange,
  editing,
  onRemoved,
}: {
  sets: Sets
  onChange: (next: Sets) => void
  /** The job open in a form, counted by what it picks now rather than by what was saved. */
  editing?: Choice & { name: string }
  /** Told each list that went, with the patterns its jobs took over. */
  onRemoved?: (name: string, patterns: string[]) => void
}) {
  const { t } = useT()
  const [adding, setAdding] = useState('')
  const [asking, setAsking] = useState<{ name: string; jobs: RawJob[]; count: number } | null>(null)
  const [refused, setRefused] = useState<{ name: string; text: string } | null>(null)

  const names = Object.keys(sets).sort()
  const without = (name: string) => {
    const next = { ...sets }
    delete next[name]
    return next
  }
  // A list still named by a job would make the engine refuse the settings,
  // so the jobs take over its patterns first, once somebody has seen how many
  // there are. An empty list a job takes all its files from cannot go: the
  // job would be left taking every file.
  const remove = async (name: string) => {
    const { jobs } = await api.config()
    const named = jobs as (Choice & { name: string })[]
    const seen = editing ? [...named.filter((j) => j.name !== editing.name), editing] : named
    const blocked = stranded(seen, name, sets[name] ?? [])
    if (blocked.length > 0) return setRefused({ name, text: t('sets.removeStranded', { name: blocked.join(', ') }) })
    setRefused(null)
    const count = jobsUsing(named, name, editing)
    if (count === 0) gone(name)
    else setAsking({ name, jobs, count })
  }
  const gone = (name: string) => {
    onChange(without(name))
    onRemoved?.(name, sets[name] ?? [])
  }
  const removeFromJobs = async () => {
    if (!asking) return
    const { name, jobs } = asking
    setAsking(null)
    await api.saveConfig(handOver(jobs, name, sets[name] ?? []))
    gone(name)
  }

  return (
    <div className="flex flex-col gap-4">
      {names.length === 0 && <p className="text-subline text-carbon-textMuted">{t('sets.none')}</p>}

      {names.map((name) => (
        <div key={name} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-subline font-medium">{name}</span>
            <IconAction
              title={t('sets.remove')}
              labelKey="sets.remove"
              onClick={() => void remove(name)}
            >
              <IconTrash />
            </IconAction>
          </div>
          <Lines
            value={sets[name]}
            rows={4}
            onChange={(list) => onChange({ ...sets, [name]: list })}
          />
          {refused?.name === name && <p className="text-subline text-statusFail">{refused.text}</p>}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Text value={adding} onChange={setAdding} placeholder={t('sets.newName')} mono />
        </div>
        <IconAction
          title={t('sets.add')}
          labelKey="sets.add"
          onClick={() => {
            const next = addList(sets, adding)
            if (!next) return
            onChange(next)
            setAdding('')
          }}
        >
          <IconAdd />
        </IconAction>
      </div>

      {asking && (
        <ConfirmWindow
          title={`${t('sets.remove')}: ${asking.name}`}
          message={t('sets.removeUsed', { count: asking.count })}
          confirmLabel={t('sets.remove')}
          confirmLabelKey="sets.remove"
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setAsking(null)}
          onConfirm={() => void removeFromJobs()}
        />
      )}
    </div>
  )
}

/** The value of the dropdown entry that starts a new list rather than picking one. */
const NEW_LIST = '\u0000new'

/**
 * The field for one side of a job: GlimStone's MultiSelect, so twenty lists
 * still fit, with the picks as tags. A list the other side holds is not
 * offered, since a list both included and excluded takes nothing it matches.
 * Where this instance lets the lists be edited, each picked list shows its
 * patterns below, and a list can be started from the dropdown.
 */
export function SharedListField({
  label,
  job,
  way,
  lists,
  onLists,
  onChange,
}: {
  /** Names the field for a screen reader, since a job form holds one for each side. */
  label: string
  job: Choice & { name?: string }
  way: Way
  lists: SharedLists | null
  onLists: (next: SharedLists) => void
  onChange: (next: Choice) => void
}) {
  const { t, lang } = useT()
  const host = useHost()
  const [names, setNames] = useState<string[] | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [managing, setManaging] = useState<Sets | null>(null)
  const words = useMemo(() => componentText(lang).multiSelect, [lang])
  const editable = lists !== null && !!host.saveSharedLists

  useEffect(() => {
    host
      .excludeSets()
      .then(setNames)
      .catch(() => setNames([]))
  }, [host])

  const available = lists ? Object.keys(lists.sets).sort() : names
  if (available === null) return null
  if (available.length === 0 && !editable) {
    return <p className="text-subline text-carbon-textMuted">{t('sets.noneYet')}</p>
  }

  const picked = (way === 'include' ? job.includeSets : job.excludeSets) ?? []
  const save = async (sets: Record<string, string[]>) => {
    try {
      await host.saveSharedLists!(sets)
      onLists({ ...lists!, sets })
      setRefused(null)
      return true
    } catch (e) {
      setRefused(errorText(t, e))
      return false
    }
  }
  // A list removed in the window is gone at once, as in the settings, and the
  // job in this form takes its patterns over the same way the saved jobs did.
  const removed = async (name: string, patterns: string[]) => {
    const rest = { ...lists!.sets }
    delete rest[name]
    if (job.includeSets?.includes(name) || job.excludeSets?.includes(name)) onChange(handOver([job], name, patterns)[0]!)
    try {
      await host.saveSharedLists!(rest)
      onLists((await host.sharedLists?.()) ?? { ...lists!, sets: rest })
    } catch (e) {
      setRefused(errorText(t, e))
    }
  }
  const create = async () => {
    const next = addList(lists!.sets, naming ?? '')
    if (!next) return
    const name = (naming ?? '').trim()
    if (await save(next)) {
      setNaming(null)
      onChange(setSide(job, way, [...picked, name]))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <MultiSelect
        label={label}
        hideLabel
        options={[
          ...offered(available, job, way).map((name) => ({ value: name, label: name })),
          ...(editable ? [{ value: NEW_LIST, label: t('sets.newList') }] : []),
        ]}
        value={picked}
        onChange={(next) => {
          if (next.includes(NEW_LIST)) setNaming('')
          else onChange(setSide(job, way, next))
        }}
        placeholder={t('edit.pickLists')}
        text={words}
      />
      {naming !== null && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Text value={naming} onChange={setNaming} placeholder={t('sets.newName')} mono />
          </div>
          <IconAction title={t('sets.add')} labelKey="sets.add" onClick={() => void create()}>
            <IconAdd />
          </IconAction>
        </div>
      )}
      {editable &&
        picked.map((name) => (
          <ListPatterns
            key={name}
            name={name}
            patterns={lists.sets[name] ?? []}
            jobs={jobsUsing(lists.jobs as (SetChoice & { name: string })[], name, { ...job, name: job.name ?? '' })}
            onSave={(patterns) => save({ ...lists.sets, [name]: patterns })}
          />
        ))}
      {refused && <p className="text-subline text-statusFail">{refused}</p>}
      {editable && (
        <div className="flex justify-end">
          <Button
            label={t('sets.manage')}
            labelKey="sets.manage"
            tone="subtle"
            onClick={() => {
              setRefused(null)
              setManaging(lists.sets)
            }}
          />
        </div>
      )}
      {managing && (
        <Dialog
          title={t('engine.sets')}
          hint={t('engine.setsHint')}
          width="wide"
          closeOnBackdrop={false}
          onClose={() => setManaging(null)}
          footer={
            <>
              <Button label={t('confirm.cancel')} labelKey="confirm.cancel" tone="subtle" onClick={() => setManaging(null)} />
              <Button
                label={t('edit.save')}
                labelKey="edit.save"
                onClick={() => void save(managing).then((ok) => ok && setManaging(null))}
              />
            </>
          }
        >
          <SharedListEditor
            sets={managing}
            onChange={setManaging}
            editing={{ ...job, name: job.name ?? '' }}
            onRemoved={(name, patterns) => void removed(name, patterns)}
          />
          {refused && <p className="mt-3 text-subline text-statusFail">{refused}</p>}
        </Dialog>
      )}
    </div>
  )
}

/**
 * A picked list's patterns, editable where the job is edited. Saving changes
 * the shared list, so every job that uses it changes too, and the line beside
 * Save says how many before it happens.
 */
function ListPatterns({
  name,
  patterns,
  jobs,
  onSave,
}: {
  name: string
  patterns: string[]
  jobs: number
  onSave: (patterns: string[]) => Promise<boolean>
}) {
  const { t } = useT()
  const [draft, setDraft] = useState<string[] | null>(null)
  const edited = draft !== null && draft.join('\n') !== patterns.join('\n')
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="min-w-0 truncate font-mono text-subline font-medium">{name}</span>
        <Lines value={draft ?? patterns} rows={3} onChange={setDraft} />
      </label>
      {edited && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-subline text-carbon-textSub">{t('sets.usedBy', { count: jobs })}</p>
          <Button
            label={t('sets.saveList')}
            labelKey="sets.saveList"
            onClick={() => void onSave(draft).then((ok) => ok && setDraft(null))}
          />
        </div>
      )}
    </div>
  )
}
