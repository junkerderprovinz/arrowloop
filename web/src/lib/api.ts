// The one place that talks to the engine. Every type here mirrors one the Go
// side defines.

/** Which way a job is allowed to write. */
export type Direction = 'both' | 'leftToRight' | 'rightToLeft'

/**
 * What a one-way job does beyond copying: what happens to files that leave the
 * source. The engine refuses anything but `sync` on a two-way job.
 */
export type Mode = 'sync' | 'mirror' | 'move'

export type Job = {
  name: string
  left: string
  right: string
  direction: Direction
  schedule: string
  /** Whether it also reacts to changes as they happen; see jobView on the Go
   *  side for why this cannot be read out of the schedule. */
  watch: boolean
  disabled: boolean
  running: boolean
  lastSuccess: string | null
}

export type { Reason } from './i18n'
import type { Reason } from './i18n'

/** What one side holds: its name there, its size and when it changed. */
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
  /** The product behind the target and its logo, named by the engine from the
   *  target's settings (internal/remotes/identify.go). */
  provider?: string
  mark?: string
  settings: { key: string; value: string; secret: boolean }[]
}

/**
 * Files on one side whose content is identical. `wasted` and `scanned` cover
 * the whole walk, not just the groups that were sent.
 */
export type Duplicates = {
  job: string
  side: string
  groups: { hash: string; size: number; paths: string[]; wasted: number }[]
  /** What deleting the extra copies would return. */
  wasted: number
  scanned: number
  /** Candidates the target refused to hash, which leave the answer incomplete. */
  unhashable: number
}

/**
 * How full a target is. An absent figure means the target does not know, which
 * is normal for a bucket store and must not render like a figure of zero.
 */
export type Usage = {
  /** False when the backend has no way to answer, which is not an error. */
  supported: boolean
  total?: number
  used?: number
  free?: number
  trashed?: number
  other?: number
  /** Present only when the target was asked and refused. */
  reason?: string
}

/**
 * A product somebody is looking for, as opposed to the rclone backend that
 * speaks to it: Nextcloud, ownCloud and OpenCloud are three providers on one
 * `webdav` backend.
 */
export type Provider = {
  id: string
  /** The product's own name, which is not translated. */
  name: string
  backend: string
  /** Which of the three cards this belongs on. */
  group: 'cloud' | 'storage' | 'protocol'
  /** Written into the target without anybody being asked. */
  preset?: Record<string, string>
  /** The component name of its logo, absent where there is none. */
  mark?: string
  hint?: string
  /** The pattern this product's address has to match, where that is not
   *  obvious. A shape rather than a sentence, so it needs no translation. */
  urlHint?: string
  /**
   * How this product wants to be signed into. The screen writes one translated
   * sentence per style, and an unknown value is ignored rather than shown.
   */
  auth?: 'apppassword' | 'oauth' | 'apikey' | 'accesskey' | 'login'
  /** Where that credential is created, where there is one page to point at. */
  authUrl?: string
}

export type Backend = {
  name: string
  description: string
  /** Reachable only with an OAuth token that has to be obtained outside this
   *  program, which the form has to say. */
  needsToken?: boolean
  options: {
    name: string
    help: string
    required: boolean
    secret: boolean
    /**
     * Without this, the target will not work in practice. Separate from
     * `required`, which describes rclone's interactive setup: s3 marks none of
     * its options required.
     */
    essential?: boolean
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
   * Whether the program is registered to start with the session. Read back from
   * the operating system on every request, so the switch notices an entry that
   * was removed elsewhere.
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
 * A job exactly as it stands in the configuration file. Unknown keys are
 * carried through, so a field this build does not understand survives an edit.
 */
export type RawJob = {
  name?: string
  left?: string
  right?: string
  state?: string
  schedule?: string
  direction?: Direction
  mode?: Mode
  disabled?: boolean
  watch?: boolean
  watchSettle?: string
  runAtStart?: boolean
  quietPeriod?: string
  emptyDirs?: boolean
  metadata?: boolean
  /** Names of shared pattern lists this job asks for. */
  excludeSets?: string[]
  /** Runs the whole comparison on the schedule and applies nothing. */
  reportOnly?: boolean
  /**
   * Delete outright instead of moving into the side's own trash. Spelled as the
   * negative, like the Go field, so a missing field keeps the trash.
   */
  noTrash?: boolean
  exclude?: string[]
  [key: string]: unknown
}

/**
 * One thing a run did to one path. A conflict resolved by a scheduled run was
 * resolved on somebody's behalf, and this is the only place that says so.
 */
export type RunEntry = {
  Kind: string
  Side: string
  Path: string
  /** An error's own words, or which way a conflict went. Often empty. */
  Note: string
  /** How big the file was. Zero for a folder, a skip and an error. */
  Size: number
}

/** One thing that happened to one file, with the run it belonged to. */
export type Touch = RunEntry & {
  Run: number
  Job: string
  When: string
}

/**
 * The configuration's top-level keys, apart from the job list. Open, so a key
 * this build has never heard of survives being read and written back.
 */
export type Settings = {
  bwlimit?: string
  parallelJobs?: number
  history?: string
  /** Per-job settings that fill in what a job does not say for itself. */
  defaults?: {
    direction?: string
    mode?: string
    schedule?: string
    modWindow?: string
    transfers?: number
    quietPeriod?: string
    emptyDirs?: boolean
    metadata?: boolean
    brakePercent?: number
    brakeFloor?: number
    /**
     * Undefined means ask the two sides. The override exists because backends
     * misreport: a Windows share mounted on Linux claims to be case-sensitive.
     */
    foldCase?: boolean
  }
  /**
   * What a scheduled run does after it fails. Engine-wide rather than per job,
   * because patience after a failure depends on the machine, not the folder pair.
   */
  retry?: {
    /** Further tries before it waits for the clock. Zero means none, and
     *  undefined means the engine's own three. */
    attempts?: number
    /** Before the first further try, as a Go duration. Each try after that
     *  waits twice as long. */
    wait?: string
  }
  /** Reusable pattern lists, by name. A job asks for them by name. */
  excludeSets?: Record<string, string[]>
  notify?: {
    matrix?: { homeserver: string; room: string; token: string }
    webhook?: string
    onSuccess?: boolean
  }
  [key: string]: unknown
}

/**
 * What the runs added up to, day by day. Every day in the window is present,
 * including empty ones, so a machine at rest does not look like one that stopped.
 */
export type HistoryStats = {
  from: string
  to: string
  /** The window actually used, so a request that was cut down says so. */
  days: number
  zone: string
  job: string
  byJob: boolean
  rows: DailyStat[]
  totals: StatCounts
}

export type StatCounts = {
  runs: number
  failed: number
  copied: number
  moved: number
  trashed: number
  conflicts: number
  dirsMade: number
  dirsRemoved: number
  unchanged: number
  skipped: number
}

export type DailyStat = StatCounts & { day: string; job: string }

/**
 * One thing wrong with a job. The engine's own sentence travels beside the
 * code, so a locale can take codes over one at a time.
 */
export type CheckFinding = {
  code: string
  side?: string
  vars?: Record<string, string>
  text: string
  /** Fatal means a run would not get off the ground. */
  fatal: boolean
}

export type CheckReport = {
  job: string
  ok: boolean
  findings: CheckFinding[]
}

export type VerifyFinding = {
  code: string
  path: string
  side?: string
  vars?: Record<string, string>
  text: string
  /** No future run will notice this by itself: the record says both sides
   *  agree and they do not. */
  invisible: boolean
}

export type VerifyReport = {
  job: string
  checked: number
  found: number
  returned: number
  truncated: boolean
  findings: VerifyFinding[]
}

/**
 * One thing in a job's bin.
 *
 * `filed` is null when the run id cannot be read; such an entry is listed but
 * never pruned by age. `modified` is the file's own time, not when it was
 * deleted, because a local move is a rename.
 */
export type TrashEntry = {
  path: string
  runId: string
  remote: string
  size: number
  filed: string | null
  modified: string
}

export type TrashListing = {
  job: string
  side: string
  store: string
  /** Uncapped, so a shortened list can never read as a complete one. */
  total: number
  entries: TrashEntry[]
}

export type RunEvent = {
  job: string
  /** `moving` is not drawn here, but it has to be known so its frames do not
   *  fall through to the generic handler. See App.tsx. */
  phase: 'started' | 'progress' | 'finished' | 'moving'
  error?: string
  done?: number
  total?: number
  kind?: string
  path?: string
  /** Which side the work lands on. */
  side?: string
}

// Checks the status before parsing, so a 500 with an HTML page does not turn
// into a JSON error somewhere else.
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

/**
 * Which runs a history listing asks for. Mirrors internal/history's Show, with
 * 'all' standing for the server's empty string so a selector has a value.
 */
export type HistoryShow = 'all' | 'changed' | 'failed'

export const api = {
  jobs: () => request<Job[]>('/api/jobs'),
  plan: (name: string) => request<Plan>(`/api/jobs/${encodeURIComponent(name)}/plan`),
  /**
   * The run log, newest first. `show` filters at the server: a watching job
   * writes a run a minute, so filtering the fetched page would miss most runs.
   */
  history: (job?: string, show: HistoryShow = 'all', limit = 50, since = '', until = '') =>
    request<Run[]>(
      `/api/history?limit=${limit}` +
        (job ? `&job=${encodeURIComponent(job)}` : '') +
        (show !== 'all' ? `&show=${show}` : '') +
        // Plain dates, so the server decides in its own zone where a day begins.
        (since ? `&since=${since}` : '') +
        (until ? `&until=${until}` : ''),
    ),

  /**
   * Start a run. `only` sends exactly the ticked paths, and an empty array
   * means nothing rather than everything.
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
   * Cancel a running job. There is nothing to resume: the next run starts from
   * the beginning. `false` means nothing was running under that name.
   */
  stopJob: (name: string) =>
    request<{ stopped: boolean }>(`/api/jobs/${encodeURIComponent(name)}/stop`, {
      method: 'POST',
    }),

  /** What one run did, path by path. Fetched when a run is opened, not with the list. */
  runEntries: (id: number) => request<RunEntry[]>(`/api/history/${id}/entries`),

  /** What one job has done to individual files, newest first, across its runs. */
  jobTouches: (job: string, limit = 50, q = '') =>
    request<Touch[]>(
      `/api/jobs/${encodeURIComponent(job)}/touches?limit=${limit}` +
        (q ? `&q=${encodeURIComponent(q)}` : ''),
    ),

  /**
   * The same log across every job. An empty argument does not narrow. The
   * database does the filtering, because the log is far longer than a page.
   */
  log: (job = '', kinds: string[] = [], q = '', limit = 100) =>
    request<Touch[]>(
      `/api/log?limit=${limit}` +
        (job ? `&job=${encodeURIComponent(job)}` : '') +
        (q ? `&q=${encodeURIComponent(q)}` : '') +
        (kinds.length ? `&kind=${encodeURIComponent(kinds.join(','))}` : ''),
    ),

  /**
   * Tests settings that are not saved yet (internal/remotes/trycheck.go).
   * `remote` names the target being edited, whose stored secrets fill the
   * password boxes the form left empty.
   */
  tryRemote: (type: string, settings: Record<string, string>, remote?: string) =>
    request<{ ok: boolean; reason?: string }>('/api/remotes-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, settings, name: remote ?? '' }),
    }),

  /** Identical files on one side. Not across both, because a job's two sides are supposed to match. */
  duplicates: (job: string, side: 'left' | 'right', limit = 200) =>
    request<Duplicates>(
      `/api/jobs/${encodeURIComponent(job)}/duplicates/${side}?limit=${limit}`,
    ),

  /** The last month of runs, one row per day. An empty job name means all of them. */
  historyStats: (job?: string, days = 30) =>
    request<HistoryStats>(
      `/api/history/stats?days=${days}${job ? `&job=${encodeURIComponent(job)}` : ''}`,
    ),

  /**
   * Whether this install wants a password, and whether this browser has given
   * one. Asked before anything else is drawn, so a page load does not start
   * with a 401.
   */
  session: () => request<{ required: boolean; authenticated: boolean }>('/api/session'),

  login: (password: string) =>
    request<{ ok: boolean }>('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),

  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),

  settings: () => request<Settings>('/api/settings'),

  /** The configuration file as text, so a backup keeps keys this build does not know. */
  rawConfig: async (): Promise<string> => {
    const res = await fetch('/api/config/raw')
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.text()
  },

  /** Put a saved configuration back. Validated by the same rules a hand-written file is. */
  replaceConfig: (doc: string) =>
    request<{ jobs: number }>('/api/config/raw', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: doc,
    }),

  /** Save the settings. The server merges, so a key this build does not send stays. */
  saveSettings: (settings: Settings) =>
    request<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),

  /** Can this job even work: both sides there, writable, room, record readable. */
  checkJob: (name: string) =>
    request<CheckReport>(`/api/jobs/${encodeURIComponent(name)}/check`, { method: 'POST' }),

  /** Do the two sides match what the record says about them. */
  verifyJob: (name: string) =>
    request<VerifyReport>(`/api/jobs/${encodeURIComponent(name)}/verify`),

  trash: (job: string, side: string) =>
    request<TrashListing>(`/api/jobs/${encodeURIComponent(job)}/trash/${side}`),

  restoreTrash: (job: string, side: string, path: string, runId: string) =>
    request<{ restored: string }>(`/api/jobs/${encodeURIComponent(job)}/trash/${side}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, runId }),
    }),

  pruneTrash: (job: string, side: string, olderThanDays: number) =>
    request<{ entries: number; bytes: number; unknown: number }>(
      `/api/jobs/${encodeURIComponent(job)}/trash/${side}/prune`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanDays }),
      },
    ),

  remotes: () =>
    request<{
      remotes: Remote[]
      backends: Backend[]
      providers: Provider[]
      /** Compiled-in backends no provider entry covers. */
      unlisted: Backend[] | null
    }>('/api/remotes'),

  saveRemote: (name: string, type: string, settings: Record<string, string>) =>
    request<{ saved: string }>(`/api/remotes/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, settings }),
    }),

  deleteRemote: (name: string) =>
    request<{ deleted: string }>(`/api/remotes/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  /** Open a target and list it. A refusal comes back as ok:false, not an error status. */
  checkRemote: (name: string) =>
    request<{ ok: boolean; reason?: string }>(`/api/remotes/${encodeURIComponent(name)}/check`, {
      method: 'POST',
    }),

  /** How full a target is. A request of its own because it goes over the network. */
  aboutRemote: (name: string) =>
    request<Usage>(`/api/remotes/${encodeURIComponent(name)}/about`),

  /** What this build can do. Every build answers, so asking never fails. */
  capabilities: () => request<{ window: boolean; version: string }>('/api/capabilities'),

  /** The folders inside one folder. An empty path asks for the roots. */
  browse: (path?: string) =>
    request<{ path: string; parent: string; entries: { name: string; path: string }[] }>(
      `/api/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    ),

  /** Makes one folder inside `parent`. The server refuses a name that is a path. */
  makeDir: (parent: string, name: string) =>
    request<{ path: string }>('/api/browse/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent, name }),
    }),

  /**
   * The window settings, which only a desktop build has. The capabilities are
   * asked first, so a container does not log an expected 404 on every load.
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

  /** Write the whole job list back. It is validated as a whole, and a refusal changes nothing. */
  saveConfig: (jobs: RawJob[]) =>
    request<{ jobs: RawJob[] }>('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs }),
    }),

  /**
   * Deletes a job's state database. The server resolves the file from the job's
   * entry, so this has to be called while the job is still configured.
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
