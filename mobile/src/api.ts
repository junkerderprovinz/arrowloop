/**
 * The engine's own API, over loopback.
 *
 * The SAME REST surface the web interface uses - `internal/web/api.go` - and
 * deliberately no second one. A phone-shaped API would be a second contract to
 * keep in step with the first, and the two would disagree the first time a
 * field changed. What differs between the desktop and the phone is which
 * screens exist, not what the engine can be asked.
 *
 * 127.0.0.1 and nothing else, and that address is an implementation detail
 * rather than something to show anybody: the engine runs INSIDE this app, as a
 * child process, and loopback is simply how two parts of one program talk. The
 * engine binds it because it has no login of its own - on a phone there is no
 * network boundary to hide behind, and a port on 0.0.0.0 would hand a tool
 * that deletes files to anybody on the same wifi.
 */

export const ORIGIN = "http://127.0.0.1:8422";

// ---------------------------------------------------------------------------
// What the engine says
// ---------------------------------------------------------------------------

/** A job as the LIST shows it: resolved, with what it is doing right now. */
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
}

/** A job as the FILE holds it, which is what an editor works on. */
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
  // `firstRun` used to live here. It is gone from the engine - the three-way
  // comparison answers "which side do I believe the first time" from the state
  // database instead - and a type that still declared it was one edit away from
  // writing it back into a file the engine now has to strip on every load.
  keepVersions?: number;
  reportOnly?: boolean;
  noTrash?: boolean;
  exclude?: string[];
  noDefaultExcludes?: boolean;
  excludeSets?: string[];
  direction?: string;
  /** What a ONE-WAY job does beyond copying: "sync", "mirror" or "move". The
   *  engine refuses any of the other two on a two-way job, because both decide
   *  which side is right and a two-way job has not said. */
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
 * One path a run touched.
 *
 * CAPITALISED, because the engine sends this struct without json tags and Go
 * then uses the field names as they are written. Assuming the lower-case shape
 * the rest of the API uses produced a screen with the right counts and no
 * paths at all - every row rendered an empty string, which looks like a
 * styling problem and is a contract problem.
 */
export interface Entry {
  Path: string;
  Kind: string;
  Side?: string;
  Note?: string;
  Size?: number;
}

/**
 * Why the engine decided something, as a translatable thing rather than a
 * sentence.
 *
 * The engine sends a CODE and the values that go in it, and `text` is the
 * English it would have written. A screen renders the code through its own
 * table, which is how a German phone gets a German reason for a decision the
 * engine made in Go.
 */
export interface Reason {
  code: string;
  vars?: Record<string, string>;
  text: string;
}

/** One side's version of a file, as a plan describes it. */
export interface SideVersion {
  path: string;
  size: number;
  mod: string;
}

/** One proposed change, from a preview. */
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
 * The one call that answers "what storage exists and what could exist".
 *
 * ONE request rather than three, because the engine answers it as one: the
 * configured remotes, the products it can offer, the backends behind them, and
 * the backends no product entry covers. Asking separately would be three round
 * trips for one screen and three chances for them to disagree.
 */
export interface Storage {
  remotes: Remote[];
  providers: Provider[];
  backends: Backend[];
  unlisted: Backend[];
}

/** What a bin holds, and where it is. */
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
  /** `key` and not `name`, which is the engine's own field. Reading `name`
   *  here produced an edit form for an existing target with every field
   *  empty, and an empty field means "leave the secret alone" - so saving it
   *  would have looked like it worked and changed nothing. */
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
}

/**
 * One file in a bin.
 *
 * `filed` is when the run that deleted it happened and is null when the run id
 * cannot be read, which is a real state rather than an oddity: such a file can
 * still be restored but never pruned by age, because its age is unknown.
 * `modified` is what the file itself says.
 *
 * The `runId` is not decoration either - it is half of the address. A path can
 * be in the bin several times over from several runs, and restoring needs to
 * know which one.
 */
export interface TrashItem {
  path: string;
  runId: string;
  remote: string;
  size: number;
  filed: string | null;
  modified: string;
}

/** Whether a run went badly, by the same rule the engine uses. */
export function failed(run: Run): boolean {
  return run.Err !== "";
}

/** What a run actually changed, which is not the same as what it looked at. */
export function touched(run: Run): number {
  return run.Copied + run.Moved + run.Trashed + run.DirsMade + run.DirsRemoved;
}

// ---------------------------------------------------------------------------
// Asking it
// ---------------------------------------------------------------------------

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
    // A refused connection is the engine not being up YET, which on a cold
    // start is the ordinary case rather than a fault. Named as itself so the
    // screens can say "starting" instead of "network error", which is what
    // every wrapper of this kind says and what nobody can act on.
    throw new EngineError(0, String(cause));
  }
  if (!response.ok) {
    // The engine answers an error as {"error": "..."} and that sentence is
    // written for a person. Falling back to the status code only when there is
    // no sentence keeps the useful case useful.
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // A body that is not JSON tells us nothing the status has not.
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
   * Whether the engine is up and answering, rather than merely started.
   *
   * With a TIMEOUT of its own, and that is not belt-and-braces: a health check
   * without one can hang, and a caller polling it in a loop then never reaches
   * its own deadline. Measured on the rig - the screen sat on "starting the
   * engine" for three minutes against a sixty-second limit, because the limit
   * was checked between calls that never came back.
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
  /** A dry run: what WOULD happen, without doing any of it. */
  plan: (job: string) => call<Plan>(`/api/jobs/${name(job)}/plan`),
  check: (job: string) => call<unknown>(`/api/jobs/${name(job)}/check`, { method: "POST" }),
  forgetState: (job: string) => call<void>(`/api/jobs/${name(job)}/state`, { method: "DELETE" }),

  trash: (job: string, side: string) => call<Bin>(`/api/jobs/${name(job)}/trash/${side}`),
  /** ONE file, addressed by path AND run: the same path can be in the bin
   *  several times over from several runs. */
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

  config: () => call<Config>("/api/config"),
  writeConfig: (config: Config) =>
    call<void>("/api/config", { method: "PUT", body: JSON.stringify(config) }),

  /** Remotes, providers and backends in one answer - see Storage. */
  storage: () => call<Storage>("/api/remotes"),
  saveRemote: (remote: string, body: { type: string; settings: Record<string, string> }) =>
    call<void>(`/api/remotes/${name(remote)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteRemote: (remote: string) =>
    call<void>(`/api/remotes/${name(remote)}`, { method: "DELETE" }),
  /** Whether the target answers. The sentence is `reason`, not `error` - the
   *  engine's own field name, and the card showed a red badge with nothing
   *  under it for exactly as long as this said otherwise. */
  checkRemote: (remote: string) =>
    call<{ ok: boolean; reason?: string }>(`/api/remotes/${name(remote)}/check`, { method: "POST" }),
  aboutRemote: (remote: string) => call<Usage>(`/api/remotes/${name(remote)}/about`),

  /** What this BUILD is - the version, and whether it has a window. The
   *  storage list is not here; that is `storage()`. */
  capabilities: () => call<{ version: string; window: boolean }>("/api/capabilities"),

  /** What is inside a folder, for picking one without typing a path. */
  browse: (path: string) =>
    call<{ path: string; entries: { name: string; dir: boolean }[] }>(
      `/api/browse?path=${encodeURIComponent(path)}`,
    ),
  makeDir: (path: string) =>
    call<void>("/api/browse/mkdir", { method: "POST", body: JSON.stringify({ path }) }),
};

/**
 * The engine's event stream, as an async iterator.
 *
 * Server-sent events over `fetch`, because React Native has no EventSource.
 * The alternative was polling, and polling is what makes a list of jobs feel
 * like a web page from 2005: a run that finishes is visible when it finishes,
 * not up to five seconds later.
 *
 * The engine sends a comment line every twenty seconds precisely so a silent
 * stream is distinguishable from a dead one, and this keeps reading until the
 * caller stops it.
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
    // Events are separated by a blank line. Anything after the last one is a
    // partial event and stays in the buffer - splitting on every newline is
    // the classic way to hand a screen half a JSON object.
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
