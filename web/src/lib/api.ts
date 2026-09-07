// The one place that talks to the engine. Everything here mirrors a type the
// Go side already defines; nothing is invented on this side.

/** Which way a job is allowed to write. */
export type Direction = 'both' | 'leftToRight' | 'rightToLeft'

export type Job = {
  name: string
  left: string
  right: string
  direction: Direction
  schedule: string
  disabled: boolean
  running: boolean
  lastSuccess: string | null
}

export type { Reason } from './i18n'
import type { Reason } from './i18n'

/** What one side holds right now: its name there, its size and when it changed. */
export type SideVersion = { path: string; size: number; mod: string }

export type ActionKind = 'copy' | 'move' | 'delete' | 'conflict' | 'mkdir' | 'rmdir'

export type Action = {
  path: string
  kind: ActionKind
  from?: string
  to?: string
  reason: Reason
  left?: SideVersion
  right?: SideVersion
}

/** What to do with two versions of a file that disagree. */
export type Resolution = 'both' | 'left' | 'right'

/** One configured storage target. */
export type Remote = {
  name: string
  type: string
  settings: { key: string; value: string; secret: boolean }[]
}

/** One kind of storage this build can reach, described by the backend itself. */
export type Backend = {
  name: string
  description: string
  options: {
    name: string
    help: string
    required: boolean
    secret: boolean
    advanced: boolean
    default: string
    examples?: { value: string; help: string }[]
  }[]
}

/** What a desktop window's own buttons do, and whether the program starts on its own. */
export type WindowSettings = {
  tray: boolean
  closeToTray: boolean
  minimiseToTray: boolean

  /**
   * Whether the program is registered to start with the session.
   *
   * Read back from the operating system on every request rather than stored
   * beside the others, so the switch cannot go on claiming autostart is on
   * after somebody removed the entry with the Task Manager's own startup tab.
   */
  startWithSystem: boolean

  /** Whether this system has an autostart mechanism at all. False means the
   *  switch is left out rather than drawn and inert. */
  canStartWithSystem: boolean
}

/** One registered drive, attached or not. */
export type Volume = {
  id: string
  label: string
  mount: string
  attached: boolean
  lastSeen: string | null
  path: string
}

export type Skip = { path: string; reason: Reason }

export type Plan = {
  actions: Action[]
  dirs: Action[]
  skipped: Skip[]
  unchanged: number
  agreed: number
}

export type Run = {
  /** The row's own id, which is how its per-file entries are asked for. */
  ID: number
  Job: string
  Started: string
  Finished: string
  Copied: number
  Moved: number
  Trashed: number
  Conflicts: number
  DirsMade: number
  DirsRemoved: number
  Unchanged: number
  Skipped: number
  Err: string
}

/**
 * A job exactly as it stands in the configuration file, rather than as the
 * parsed struct sees it. Unknown keys are carried through untouched, so a field
 * this build does not understand survives being edited by it.
 */
export type RawJob = {
  name?: string
  left?: string
  right?: string
  state?: string
  schedule?: string
  direction?: Direction
  disabled?: boolean
  watch?: boolean
  watchSettle?: string
  runAtStart?: boolean
  quietPeriod?: string
  emptyDirs?: boolean
  metadata?: boolean
  exclude?: string[]
  [key: string]: unknown
}

/**
 * One thing a run did to one path.
 *
 * The counts on a Run say how much; this says which file and, for a conflict,
 * what was decided. A conflict resolved by a scheduled run was resolved on
 * somebody's behalf, and this is the only place that ever says so.
 */
export type RunEntry = {
  Kind: string
  Side: string
  Path: string
  /** An error's own words, or which way a conflict went. Often empty. */
  Note: string
}

/**
 * The configuration's top-level keys, apart from the job list.
 *
 * Deliberately open: a key this build has never heard of still has to survive
 * being read and written back, the same way a job's unknown fields do. A closed
 * type here would mean an older interface silently deleting a newer setting on
 * every save.
 */
export type Settings = {
  bwlimit?: string
  parallelJobs?: number
  history?: string
  /**
   * Per-job settings that fill in what a job does not say for itself.
   *
   * Two asks pointed the same way. These had to become visible, and the job
   * form was already the thing that was too long. The answer that is usually
   * the same for every job belongs in one place, and the job keeps only what
   * makes IT different.
   */
  defaults?: {
    modWindow?: string
    transfers?: number
    quietPeriod?: string
    emptyDirs?: boolean
    metadata?: boolean
    brakePercent?: number
    brakeFloor?: number
  }
  notify?: {
    matrix?: { homeserver: string; room: string; token: string }
    webhook?: string
    onSuccess?: boolean
  }
  [key: string]: unknown
}

export type RunEvent = {
  job: string
  phase: 'started' | 'progress' | 'finished'
  error?: string
  done?: number
  total?: number
  kind?: string
  path?: string
  /** Which side the work lands on, so a screen can say where a file is going. */
  side?: string
}

/**
 * Every response is checked before it is parsed.
 *
 * A decoder that goes straight to json() turns a 500 with an HTML error page
 * into a parse failure three layers away from the thing that actually went
 * wrong, and a 404 into an empty screen that looks like "nothing to do".
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body?.error) detail = body.error
    } catch {
      // The body was not the JSON error shape; the status line has to do.
    }
    throw new Error(detail)
  }
  return (await res.json()) as T
}

export const api = {
  jobs: () => request<Job[]>('/api/jobs'),
  plan: (name: string) => request<Plan>(`/api/jobs/${encodeURIComponent(name)}/plan`),
  history: (job?: string, limit = 50) =>
    request<Run[]>(`/api/history?limit=${limit}${job ? `&job=${encodeURIComponent(job)}` : ''}`),

  /**
   * Start a run. Passing `only` sends exactly the paths that were ticked, and
   * an empty array means an empty selection rather than "everything" — those
   * two have to stay apart, or unticking every row would run the whole plan.
   */
  run: (name: string, only?: string[], resolve?: Record<string, Resolution>) =>
    request<{ job: string; status: string }>(`/api/jobs/${encodeURIComponent(name)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(only === undefined ? {} : { only }),
        ...(resolve && Object.keys(resolve).length > 0 ? { resolve } : {}),
      }),
    }),

  /**
   * What one run did, path by path.
   *
   * Asked for when a run is opened rather than fetched with the list: fifty
   * runs' worth of paths, to draw fifty rows that each say "12 copied", is
   * thousands of strings nobody reads.
   */
  runEntries: (id: number) => request<RunEntry[]>(`/api/history/${id}/entries`),

  settings: () => request<Settings>('/api/settings'),

  /**
   * Save the settings. The whole draft goes, and the server merges: a key this
   * build does not know about is not mentioned and therefore not touched.
   */
  saveSettings: (settings: Settings) =>
    request<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),

  remotes: () => request<{ remotes: Remote[]; backends: Backend[] }>('/api/remotes'),

  saveRemote: (name: string, type: string, settings: Record<string, string>) =>
    request<{ saved: string }>(`/api/remotes/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, settings }),
    }),

  deleteRemote: (name: string) =>
    request<{ deleted: string }>(`/api/remotes/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  /**
   * Open a target and list it.
   *
   * A refusal comes back as ok:false with the server's own words rather than as
   * an error status, because settings that do not work are an answer to the
   * question that was asked and not a failure of the request.
   */
  checkRemote: (name: string) =>
    request<{ ok: boolean; reason?: string }>(`/api/remotes/${encodeURIComponent(name)}/check`, {
      method: 'POST',
    }),

  /**
   * What this build can do. Every build answers, including the ones that can do
   * the least, so asking costs one request and never a failed one.
   */
  capabilities: () => request<{ window: boolean; version: string }>('/api/capabilities'),

  /**
   * The folders inside one folder, for picking a job's side rather than typing
   * it. An empty path asks for the top of the tree, which is one entry on a
   * system with a single root and one per drive on Windows.
   */
  browse: (path?: string) =>
    request<{ path: string; parent: string; entries: { name: string; path: string }[] }>(
      `/api/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    ),

  /** Makes ONE folder inside the folder the picker has open. The name is a
   *  single segment and the server refuses anything that looks like a path. */
  makeDir: (parent: string, name: string) =>
    request<{ path: string }>('/api/browse/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent, name }),
    }),

  /**
   * The window settings, which only a desktop build has.
   *
   * A container has no title bar and no notification area, so it says so in its
   * capabilities and this is never called there. Asking anyway would answer 404
   * and put a red line in the browser's console on every load, and a console
   * full of expected errors is a console nobody reads when a real one appears.
   */
  window: async (): Promise<WindowSettings | null> => {
    const can = await api.capabilities().catch(() => ({ window: false }))
    if (!can.window) return null
    return request<WindowSettings>('/api/window')
  },

  saveWindow: (settings: WindowSettings) =>
    request<WindowSettings>('/api/window', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),

  volumes: () => request<{ volumes: Volume[] }>('/api/volumes'),

  volumeCandidates: () =>
    request<{ candidates: { mount: string; marked: boolean }[] }>('/api/volumes/candidates'),

  markVolume: (mount: string, label: string) =>
    request<Volume>('/api/volumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mount, label }),
    }),

  forgetVolume: (id: string) =>
    request<{ forgotten: string }>(`/api/volumes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  config: () => request<{ jobs: RawJob[] }>('/api/config'),

  /**
   * Write the whole job list back.
   *
   * All of it at once rather than one job at a time, because a configuration is
   * validated as a whole: two jobs sharing a name is a defect neither of them
   * can see on its own. A refusal leaves the file exactly as it was.
   */
  saveConfig: (jobs: RawJob[]) =>
    request<{ jobs: RawJob[] }>('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs }),
    }),

  /**
   * Deletes a job's state database.
   *
   * The name goes over the wire, never the path: the server resolves it from
   * the job's own entry, so this has to be called while the job is still in the
   * configuration. Nothing here can name a file.
   */
  forgetJobState: (name: string) =>
    request<{ removed: number }>(`/api/jobs/${encodeURIComponent(name)}/state`, {
      method: 'DELETE',
    }),

  /** Live run events. Returns the function that closes the stream. */
  watch: (onEvent: (ev: RunEvent) => void): (() => void) => {
    const source = new EventSource('/api/events')
    source.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data) as RunEvent)
      } catch {
        // A malformed frame is not worth taking the stream down for.
      }
    }
    return () => source.close()
  },
}
