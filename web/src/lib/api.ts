// The one place that talks to the engine. Everything here mirrors a type the
// Go side already defines; nothing is invented on this side.

export type Job = {
  name: string
  left: string
  right: string
  schedule: string
  disabled: boolean
  running: boolean
  lastSuccess: string | null
}

export type Action = {
  path: string
  kind: 'copy' | 'move' | 'delete' | 'conflict' | 'mkdir' | 'rmdir'
  from?: string
  to?: string
  reason: string
}

export type Skip = { path: string; reason: string }

export type Plan = {
  actions: Action[]
  dirs: Action[]
  skipped: Skip[]
  unchanged: number
  agreed: number
}

export type Run = {
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
  disabled?: boolean
  watch?: boolean
  watchSettle?: string
  quietPeriod?: string
  emptyDirs?: boolean
  metadata?: boolean
  exclude?: string[]
  [key: string]: unknown
}

export type RunEvent = { job: string; phase: 'started' | 'finished'; error?: string }

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
  run: (name: string, only?: string[]) =>
    request<{ job: string; status: string }>(`/api/jobs/${encodeURIComponent(name)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(only === undefined ? {} : { only }),
    }),

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
