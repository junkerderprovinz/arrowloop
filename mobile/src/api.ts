// The engine's REST API over loopback, the same one the web app uses
// (internal/web/api.go). The engine has no login, so it listens on 127.0.0.1
// only.

export const ORIGIN = "http://127.0.0.1:8422";

/** A job as the list shows it: resolved, with its live state. */
export interface Job {
  name: string;
  left: string;
  right: string;
  direction: string;
  schedule: string;
  watch: boolean;
  disabled: boolean;
  running: boolean;
  lastSuccess: string | null;
  /**
   * When the schedule next runs this job; absent for a job without a
   * schedule, a held job, or an unparsable expression (internal/web/api.go).
   */
  nextRun?: string;
}

/** A job as the configuration file holds it. */
export interface JobConfig {
  name: string;
  left: string;
  right: string;
  state?: string;
  schedule?: string;
  watch?: boolean;
  watchSettle?: string;
  runAtStart?: boolean;
  disabled?: boolean;
  keepVersions?: number;
  reportOnly?: boolean;
  noTrash?: boolean;
  exclude?: string[];
  noDefaultExcludes?: boolean;
  excludeSets?: string[];
  direction?: string;
  /** "sync", "mirror" or "move"; a two-way job only takes "sync". */
  mode?: string;
  quietPeriod?: string;
  modWindow?: string;
  transfers?: number;
  emptyDirs?: boolean;
  metadata?: boolean;
}

export interface Config {
  jobs: JobConfig[];
  [key: string]: unknown;
}

export interface Run {
  ID: number;
  Job: string;
  Started: string;
  Finished: string;
  Copied: number;
  Moved: number;
  Trashed: number;
  Conflicts: number;
  DirsMade: number;
  DirsRemoved: number;
  Unchanged: number;
  Skipped: number;
  Err: string;
}

/**
 * One path a run touched. Capitalised, since the engine sends this struct
 * without json tags.
 */
export interface Entry {
  Path: string;
  Kind: string;
  Side?: string;
  Note?: string;
  Size?: number;
}

/**
 * What one run did. `up` counts copies that landed on the right side and
 * `down` those on the left; moves are counted once, by their copy.
 */
export interface Tally {
  up: number;
  down: number;
  trashed: number;
  conflicts: number;
  /** The same deletions, split by the side they were removed from. */
  trashedLeft: number;
  trashedRight: number;
}

/** A log entry across runs, with the run and job it came from. Capitalised like Entry. */
export interface Touch extends Entry {
  Run: number;
  Job: string;
  When: string;
}

/**
 * Why the engine decided something: a code and its values to translate, and
 * `text`, the English fallback.
 */
export interface Reason {
  code: string;
  vars?: Record<string, string>;
  text: string;
}

export interface SideVersion {
  path: string;
  size: number;
  mod: string;
}

/** One proposed change in a plan. */
export interface Action {
  path: string;
  kind: string;
  from?: string;
  /** The side this lands on, not a path. */
  to?: string;
  reason: Reason;
  left?: SideVersion;
  right?: SideVersion;
}

export interface Plan {
  actions: Action[];
  dirs?: Action[];
  skipped?: Action[];
  unchanged: number;
  agreed: number;
}

/**
 * The configured remotes, the products on offer, their backends, and the
 * backends no product covers, all in one answer.
 */
export interface Storage {
  remotes: Remote[];
  providers: Provider[];
  backends: Backend[];
  unlisted: Backend[];
}

export interface Bin {
  job: string;
  side: string;
  store: string;
  dir: string;
  total: number;
  entries: TrashItem[];
}

export interface Remote {
  name: string;
  type: string;
  /** The product behind the target and its logo, as the engine identifies
   *  them (internal/remotes/identify.go); absent when unknown. */
  provider?: string;
  mark?: string;
  settings: { key: string; value: string; secret: boolean }[];
}

export interface Provider {
  id: string;
  name: string;
  backend: string;
  group: string;
  mark?: string;
  hint?: string;
  auth?: string;
  authUrl?: string;
  urlHint?: string;
  preset?: Record<string, string>;
  [key: string]: unknown;
}

export interface Backend {
  name: string;
  description?: string;
  options?: { name: string; help?: string; required?: boolean; essential?: boolean; secret?: boolean }[];
  [key: string]: unknown;
}

export interface Usage {
  supported: boolean;
  total?: number;
  used?: number;
  free?: number;
  /**
   * Set when the target could not be reached, which tells that case apart
   * from a target that answered without reporting its size.
   */
  reason?: string;
}

/**
 * One file in a bin. `filed` is when the deleting run happened, or null when
 * its run id cannot be read. A path can be in the bin once per run, so
 * `runId` is part of its address.
 */
export interface TrashItem {
  path: string;
  runId: string;
  remote: string;
  size: number;
  filed: string | null;
  modified: string;
}

/**
 * One event from the engine's stream, the same shape web/src/lib/api.ts
 * reads. The plan is built before the first byte moves, so `total` is known
 * from the first progress event.
 */
export interface RunEvent {
  job: string;
  phase: "started" | "progress" | "finished" | "moving";
  error?: string;
  done?: number;
  total?: number;
  kind?: string;
  path?: string;
  /** The side the work lands on. */
  side?: string;
  /**
   * The files in transfer on a "moving" event; the engine omits an empty list
   * (internal/daemon/runner.go).
   */
  moving?: Moving[];
  /**
   * Files per second, sent on a "moving" event without rows when too many
   * small files pass to name them.
   */
  rate?: number;
}

/**
 * One file in transfer, as rclone reports it; there are up to `transfers` at
 * once. `size` is -1 when the service does not report it.
 */
export interface Moving {
  path: string;
  bytes: number;
  size: number;
  side?: string;
}

export function failed(run: Run): boolean {
  return run.Err !== "";
}

/** Counts what a run changed, as opposed to what it compared. */
export function touched(run: Run): number {
  return run.Copied + run.Moved + run.Trashed + run.DirsMade + run.DirsRemoved;
}

export class EngineError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(ORIGIN + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    // Status 0: no connection, usually an engine that is still starting.
    throw new EngineError(0, String(cause));
  }
  if (!response.ok) {
    // The engine explains errors as {"error": "..."}.
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // Not JSON; the status is all there is.
    }
    throw new EngineError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

const name = encodeURIComponent;

export const api = {
  /**
   * Reports whether the engine answers. It has its own timeout, or a hanging
   * request would keep a polling caller from ever reaching its deadline.
   */
  async alive(): Promise<boolean> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 2000);
    try {
      await call("/api/capabilities", { signal: abort.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  },

  jobs: () => call<Job[]>("/api/jobs"),
  run: (job: string) => call<void>(`/api/jobs/${name(job)}/run`, { method: "POST" }),
  stop: (job: string) => call<void>(`/api/jobs/${name(job)}/stop`, { method: "POST" }),
  /** A dry run: what would happen, without doing any of it. */
  plan: (job: string) => call<Plan>(`/api/jobs/${name(job)}/plan`),
  check: (job: string) => call<unknown>(`/api/jobs/${name(job)}/check`, { method: "POST" }),
  forgetState: (job: string) => call<void>(`/api/jobs/${name(job)}/state`, { method: "DELETE" }),

  trash: (job: string, side: string) => call<Bin>(`/api/jobs/${name(job)}/trash/${side}`),
  /** Restores one file, addressed by path and run. */
  restoreTrash: (job: string, side: string, path: string, runId: string) =>
    call<void>(`/api/jobs/${name(job)}/trash/${side}/restore`, {
      method: "POST",
      body: JSON.stringify({ path, runId }),
    }),
  versions: (job: string, side: string) => call<Bin>(`/api/jobs/${name(job)}/versions/${side}`),
  restoreVersion: (job: string, side: string, path: string, runId: string) =>
    call<void>(`/api/jobs/${name(job)}/versions/${side}/restore`, {
      method: "POST",
      body: JSON.stringify({ path, runId }),
    }),

  history: (limit = 50) => call<Run[]>(`/api/history?limit=${limit}`),
  jobHistory: (job: string, limit = 20) =>
    call<Run[]>(`/api/history?job=${name(job)}&limit=${limit}`),
  runEntries: (id: number, limit = 200) =>
    call<Entry[]>(`/api/history/${id}/entries?limit=${limit}`),

  /** Counts what one run did; `runEntries` returns only a page. */
  runSummary: (id: number) => call<Tally>(`/api/history/${id}/summary`),

  /** Every file the engine has touched, newest first, filtered by the engine. */
  log: (q: { job?: string; contains?: string; kinds?: string[]; limit?: number } = {}) => {
    // Built by hand, since React Native's URLSearchParams is incomplete.
    const ask = [`limit=${q.limit ?? 100}`];
    if (q.job) ask.push(`job=${name(q.job)}`);
    if (q.contains) ask.push(`q=${name(q.contains)}`);
    if (q.kinds?.length) ask.push(`kind=${name(q.kinds.join(","))}`);
    return call<Touch[]>(`/api/log?${ask.join("&")}`);
  },

  config: () => call<Config>("/api/config"),
  writeConfig: (config: Config) =>
    call<void>("/api/config", { method: "PUT", body: JSON.stringify(config) }),

  storage: () => call<Storage>("/api/remotes"),
  /**
   * Tests unsaved settings without writing anything
   * (internal/remotes/trycheck.go). `remote` names the target being edited, so
   * the engine can fill in the secrets the form left empty.
   */
  tryRemote: (type: string, settings: Record<string, string>, remote?: string) =>
    call<{ ok: boolean; reason?: string }>("/api/remotes-check", {
      method: "POST",
      body: JSON.stringify({ type, settings, name: remote ?? "" }),
    }),
  saveRemote: (remote: string, body: { type: string; settings: Record<string, string> }) =>
    call<void>(`/api/remotes/${name(remote)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteRemote: (remote: string) =>
    call<void>(`/api/remotes/${name(remote)}`, { method: "DELETE" }),
  /** Reports whether the target answers; the explanation is in `reason`. */
  checkRemote: (remote: string) =>
    call<{ ok: boolean; reason?: string }>(`/api/remotes/${name(remote)}/check`, { method: "POST" }),
  aboutRemote: (remote: string) => call<Usage>(`/api/remotes/${name(remote)}/about`),

  /** The engine build's version and whether it has a window. */
  capabilities: () => call<{ version: string; window: boolean }>("/api/capabilities"),

  /** Lists the folders inside a folder; no path lists the roots. */
  browse: (path?: string) =>
    call<{ path: string; parent: string; entries: { name: string; path: string }[] }>(
      `/api/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),
  /** Makes one folder; the engine refuses a name with a path separator. */
  makeDir: (parent: string, name: string) =>
    call<{ path: string }>("/api/browse/mkdir", {
      method: "POST",
      body: JSON.stringify({ parent, name }),
    }),
};

/**
 * Yields the data of each server-sent event from the engine, read over fetch
 * since React Native has no EventSource. It reads until the signal aborts.
 */
export async function* events(signal: AbortSignal): AsyncGenerator<string> {
  const response = await fetch(ORIGIN + "/api/events", { signal });
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    // Events end with a blank line; a partial event stays in the buffer.
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const data = part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (data) yield data;
    }
  }
}
