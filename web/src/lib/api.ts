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
  /** Whether it also reacts to changes as they happen; see jobView on the Go
   *  side for why this cannot be read out of the schedule. */
  watch: boolean
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

/**
 * Files on one side whose CONTENT is identical.
 *
 * `wasted` and `scanned` describe the whole walk and never the part that was
 * sent: the search had to read the tree to answer at all, so a total worked out
 * from a truncated list would under-report by more the smaller the screen.
 */
export type Duplicates = {
  job: string
  side: string
  groups: { hash: string; size: number; paths: string[]; wasted: number }[]
  /** What deleting the extra copies would actually return. */
  wasted: number
  scanned: number
  /**
   * Candidates the target refused to hash. The one thing that makes the answer
   * incomplete, so it is carried rather than swallowed.
   */
  unhashable: number
}

/**
 * How full a target is.
 *
 * Every figure is optional and its ABSENCE means "this target does not know",
 * which is the ordinary answer for a bucket store. That is a different fact
 * from a figure of zero, which means a genuinely full disk, and the two must
 * not be allowed to render the same.
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

/** One kind of storage this build can reach, described by the backend itself. */
/**
 * A PROVIDER is what somebody is looking for; a BACKEND is what rclone speaks.
 *
 * Nextcloud, ownCloud and OpenCloud are three products and one `webdav`
 * backend. Offering the backend and expecting somebody to know that asks them
 * to know the implementation in order to use the product.
 */
export type Provider = {
  id: string
  /** The product's own name, deliberately untranslated: a brand is a brand. */
  name: string
  backend: string
  group: 'cloud' | 'protocol'
  /** Written into the target without anybody being asked. */
  preset?: Record<string, string>
  /** The component name of its logo, or absent where there is none to use. */
  mark?: string
  hint?: string
  /**
   * What this product's address looks like, where the address is not simply
   * the thing already in somebody's browser.
   *
   * A SHAPE rather than a sentence, so it needs no translation: what somebody
   * needs at that field is the pattern their own address has to match.
   */
  urlHint?: string
}

export type Backend = {
  name: string
  description: string
  /**
   * This backend can only be reached with an OAuth token, and the token has to
   * be obtained outside this program.
   *
   * Without saying so, somebody opens the Dropbox form, fills in the two boxes
   * it shows, and gets a target that cannot connect - with nothing anywhere
   * explaining that the one field that matters is fetched elsewhere.
   */
  needsToken?: boolean
  options: {
    name: string
    help: string
    required: boolean
    secret: boolean
    /**
     * Without this, the target will not work in practice.
     *
     * Separate from `required`, which describes rclone's own interactive setup
     * rather than a form: s3 marks none of its seventy-eight options required,
     * so this form used to open empty for the one backend somebody would point
     * at a cloud provider.
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
  /** Names of shared pattern lists this job asks for. */
  excludeSets?: string[]
  /** Runs the whole comparison on the schedule and applies nothing. */
  reportOnly?: boolean
  /**
   * Which side is right the ONE time this job has no record yet.
   *
   * Empty is the merge, which is what every job did before this existed. It
   * applies once: the moment a record exists it is ignored, so a setting left
   * in the file cannot quietly turn a two-way job into a one-way one.
   */
  firstRun?: string
  /**
   * Delete outright instead of moving into the side's own trash.
   *
   * Spelled as the NEGATIVE, the same way the Go field is, so the value a
   * missing field takes is the safe one: `false` has to mean "keep a trash",
   * because every configuration written before this existed has no field here
   * at all.
   */
  noTrash?: boolean
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
  /**
   * How big the file was, where the action had a size.
   *
   * Zero for a folder, a skip and an error: "not applicable" rather than "an
   * empty file", which is the only ambiguity worth having here.
   */
  Size: number
}

/**
 * One thing that happened to one file, with the run it belonged to.
 *
 * A RunEntry is enough while reading ONE run. Across runs it is not: the same
 * file copied on Tuesday and again on Friday is two identical lines, and
 * neither says when.
 */
export type Touch = RunEntry & {
  Run: number
  When: string
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
    /**
     * Three states, and undefined is one of them: ask the two sides.
     *
     * A plain boolean could not say that, and "ask" is what almost every job
     * wants. The override exists because backends lie about themselves: a share
     * exported from Windows and mounted on Linux reports itself case-sensitive
     * and is not.
     */
    foldCase?: boolean
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
 * What the runs added up to, day by day.
 *
 * Every day in the window is present, including the ones with nothing in them.
 * A series that closes its gaps turns "nothing happened" into "nothing to
 * show", and those are opposite meanings: a machine at rest and a machine that
 * stopped.
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
 * One thing wrong with a job, as the engine words it.
 *
 * The sentence travels beside the code on purpose. A screen renders `text` and
 * a locale can take a code over later, one at a time; forty-two translations of
 * twenty codes written before anybody has seen one on screen would age out of
 * step with the engine that produces them.
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
  /**
   * No future run will notice this by itself.
   *
   * The one class of problem that never fixes itself and never announces
   * itself: the record says the two sides agree, they do not, and every run
   * from now on compares both against a record that matches both.
   */
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
 * `filed` is null when the run id cannot be read, which is a real state rather
 * than a bug: such an entry is listed so nothing is hidden, and it is never
 * pruned by age because its age is unknown. `modified` is what the file says
 * about itself and is NOT when it was deleted: a local move is a rename, so a
 * document last edited in 2019 and binned this morning still reads as 2019.
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

/**
 * Which runs a history listing asks for. Mirrors internal/history's Show, and
 * 'all' is spelled out here rather than being the empty string the server uses:
 * a selector needs a value for every option it offers.
 */
export type HistoryShow = 'all' | 'changed' | 'failed'

export const api = {
  jobs: () => request<Job[]>('/api/jobs'),
  plan: (name: string) => request<Plan>(`/api/jobs/${encodeURIComponent(name)}/plan`),
  /**
   * The run log, newest first.
   *
   * `show` narrows it AT THE SERVER, which is the whole point of it being a
   * parameter rather than something the page does to what it received. A job
   * watching a folder writes a run a minute, so fifty runs is fifty minutes and
   * a job that runs once a day is not on the page at all; filtering afterwards
   * filters the fifty already fetched and leaves it just as missing.
   */
  history: (job?: string, show: HistoryShow = 'all', limit = 50, since = '', until = '') =>
    request<Run[]>(
      `/api/history?limit=${limit}` +
        (job ? `&job=${encodeURIComponent(job)}` : '') +
        (show !== 'all' ? `&show=${show}` : '') +
        // Plain YYYY-MM-DD, cut into a day at the SERVER, in the server's own
        // zone. Sending an instant instead would mean the browser deciding
        // where a day begins for a log written somewhere else.
        (since ? `&since=${since}` : '') +
        (until ? `&until=${until}` : ''),
    ),

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

  /**
   * What one job has done to individual files, newest first, across its runs.
   *
   * A different question from the run log, which is why it is a different
   * address: "which runs happened" belongs to the history tab, and "what has
   * this job actually done to my files" is the one somebody has while looking
   * at the job. jdp: "Im aktivitaetslog moechte ich nicht die laeufe sehen
   * sondern ein log ueber die einzelnen dateien."
   */
  jobTouches: (job: string, limit = 50, q = '') =>
    request<Touch[]>(
      `/api/jobs/${encodeURIComponent(job)}/touches?limit=${limit}` +
        (q ? `&q=${encodeURIComponent(q)}` : ''),
    ),

  /**
   * Files on one side that hold the same content as another.
   *
   * Per side rather than per job on purpose: a job's two sides are SUPPOSED to
   * hold the same files, so a search across both would report the sync doing
   * its work.
   */
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
   * one.
   *
   * Asked BEFORE anything else is drawn. Working it out from a 401 instead
   * would mean every page load starting with a failed request, and the
   * interface guessing at the difference between "you are logged out" and
   * "there is no login here".
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

  /**
   * The configuration file exactly as it stands, for keeping a copy of.
   *
   * Text rather than parsed and re-serialised: a backup is only worth having if
   * it comes back the same, including keys this build has never heard of.
   */
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
      /** What somebody picks from: products, not protocols. */
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
   * How full a target is, as far as the target is willing to say.
   *
   * Every number is OPTIONAL and absent means unknown, which is the common
   * answer: a bucket store has no size to report, and treating a missing figure
   * as zero would put "nothing free" on a target that has no limit at all.
   *
   * Its own request rather than a field on the target listing, because this one
   * goes over the network: folded into the list it would make opening the page
   * a round trip to every cloud account ever configured.
   */
  aboutRemote: (name: string) =>
    request<Usage>(`/api/remotes/${encodeURIComponent(name)}/about`),

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
