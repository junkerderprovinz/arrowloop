// Stopping every job before something takes the jobs away, shared so the phone
// can use it. A stop only asks a run to end, and a run still writing when its
// job is removed would write into a folder nothing tracks any more.

type Engine = {
  jobs: () => Promise<{ name: string; running: boolean }[]>
  stop: (name: string) => Promise<unknown>
}

type Wait = {
  within: number
  every: number
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Asks the engine what runs right now, stops it, and waits until nothing runs.
 * A job that starts in the meantime is stopped as well. It reports false when
 * a run is still going after `within` milliseconds.
 */
export async function stopEvery(
  engine: Engine,
  { within, every, clock = Date.now, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }: Wait,
): Promise<boolean> {
  const until = clock() + within
  const asked = new Set<string>()
  for (;;) {
    const running = (await engine.jobs()).filter((j) => j.running).map((j) => j.name)
    if (running.length === 0) return true
    if (clock() >= until) return false
    const fresh = running.filter((name) => !asked.has(name))
    fresh.forEach((name) => asked.add(name))
    await Promise.allSettled(fresh.map((name) => engine.stop(name)))
    await sleep(every)
  }
}
