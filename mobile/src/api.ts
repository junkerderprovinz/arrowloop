/**
 * The engine's own API, over loopback.
 *
 * The SAME REST surface the web interface uses - `internal/web/api.go` - and
 * deliberately no second one. A phone-shaped API would be a second contract to
 * keep in step with the first, and the two would disagree the first time a
 * field changed. What differs between the desktop and the phone is which
 * screens exist, not what the engine can be asked.
 *
 * 127.0.0.1 and nothing else. The engine binds loopback because it has no
 * login of its own: on a phone there is no network boundary to hide behind,
 * and a port on 0.0.0.0 would hand a tool that deletes files to anybody on the
 * same wifi.
 */

export const ORIGIN = "http://127.0.0.1:8422";

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

/** Whether a run went badly, by the same rule the engine uses. */
export function failed(run: Run): boolean {
  return run.Err !== "";
}

/** What a run actually changed, which is not the same as what it looked at. */
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
  return (await response.json()) as T;
}

export const api = {
  /**
   * Whether the engine is up and answering, rather than merely started.
   *
   * With a TIMEOUT of its own, and that is not belt-and-braces: a health check
   * without one can hang, and a caller polling it in a loop then never reaches
   * its own deadline. Measured on the rig - the screen sat on "starting the
   * engine" for three minutes against a sixty-second limit, because the limit
   * was checked between calls that never came back.
   *
   * Two seconds. On loopback an answer takes milliseconds and a refusal is
   * immediate; anything longer is not slowness, it is a socket going nowhere.
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
  run: (name: string) => call<void>(`/api/jobs/${encodeURIComponent(name)}/run`, { method: "POST" }),
  stop: (name: string) => call<void>(`/api/jobs/${encodeURIComponent(name)}/stop`, { method: "POST" }),

  history: (limit = 50) => call<Run[]>(`/api/history?limit=${limit}`),
  jobHistory: (name: string, limit = 20) =>
    call<Run[]>(`/api/history?job=${encodeURIComponent(name)}&limit=${limit}`),
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
