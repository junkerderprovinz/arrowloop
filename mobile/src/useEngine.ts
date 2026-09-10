import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, events } from "./api";
import { engine } from "./engine";

export type EngineState = "starting" | "ready" | "trouble";

/**
 * Starting the engine and knowing when it answers.
 *
 * Every screen depends on this, so it lives in one place: the app starts the
 * service, then asks the engine whether it is up until it is, and only then
 * are the screens allowed to fetch anything.
 *
 * A DEADLINE rather than a count of attempts. The WebView shell got this wrong
 * and it is worth not repeating: sixty rounds of "ask, then wait half a
 * second" reads like thirty seconds and is not, because the ask carries its
 * own timeout. Sixty seconds here is measured rather than generous - the
 * engine is a 79 MB static binary carrying every rclone backend, and a cold
 * start has to page all of it in.
 */
const WAIT_MS = 60_000;

/** How many lines from the START of the log go on screen. */
const HEAD_LINES = 8;

/**
 * The log, cut down to the part a person can act on.
 *
 * The TOP, not the bottom, and that is the whole point. A Go crash writes its
 * reason on the first line - "SIGSYS: bad system call" - and then several
 * hundred lines of goroutines and a register dump. Showing the tail fills a
 * phone screen with `rcx` and `rsp` while the one sentence that explains it
 * scrolls off the top. It cost a round of testing when the WebView shell did
 * exactly that, and it was about to cost another here.
 */
function readable(text: string): string {
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return "(the log is empty - the engine wrote nothing at all)";
  if (lines.length <= HEAD_LINES + 1) return lines.join("\n");
  return [...lines.slice(0, HEAD_LINES), "…", lines[lines.length - 1]].join("\n");
}

export function useEngine() {
  const [state, setState] = useState<EngineState>("starting");
  const [log, setLog] = useState("");

  const wait = useCallback(async () => {
    setState("starting");
    const until = Date.now() + WAIT_MS;
    let asked = 0;
    while (Date.now() < until) {
      asked += 1;
      if (await api.alive()) {
        setState("ready");
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    // In the log rather than only on screen, because when this screen is wrong
    // the screen is the thing that cannot be trusted. A count of zero would
    // mean the loop never ran; a count in the hundreds with the deadline
    // passed means it ran and the engine simply never came.
    console.log(`[arrowloop] gave up after ${asked} attempts in ${Date.now() - (until - WAIT_MS)}ms`);
    // What went wrong goes on screen, because the reason is in the engine's
    // own log and a person with a broken app deserves the reason rather than a
    // shrug. Whether the process is still THERE goes with it: an empty log
    // means two opposite things, and only the process can say which.
    const [text, alive] = await Promise.all([engine.log(), engine.alive()]);
    setLog(
      (alive
        ? "The engine process is still running. It started and has not answered."
        : "The engine process is gone. It started and stopped, or never started at all.") +
        "\n\n" +
        readable(text),
    );
    setState("trouble");
  }, []);

  useEffect(() => {
    if (!engine.available) {
      setLog("This build has no engine module.");
      setState("trouble");
      return;
    }
    // The wait starts NOW, not when start() resolves, and that ordering is the
    // whole of it. Chaining the wait onto the promise meant the screen's only
    // way forward was a native call returning - and when it did not, the app
    // sat on "starting the engine" indefinitely with no deadline running,
    // which is the one state this screen exists to prevent. Measured on the
    // rig: the engine had started AND died inside a second while the screen
    // was still waiting three minutes later.
    //
    // What the screen is actually waiting for is the engine to ANSWER, and
    // that is what `wait` asks. Whether the start call came back is a
    // secondary fact, useful only when it FAILED - so it is reported and
    // nothing hangs on it.
    void wait();
    engine.start().catch((e: Error) => setLog((old) => `${e.message}\n\n${old}`));
  }, [wait]);

  // Checked again when the app comes back to the front. Android may have
  // reclaimed the service while the phone was in a pocket, and a screen that
  // silently keeps showing the last data it had is worse than one that says it
  // is starting again.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && state === "ready") {
        api.alive().then((up) => {
          if (!up) engine.start().then(wait, () => setState("trouble"));
        });
      }
    });
    return () => sub.remove();
  }, [state, wait]);

  return { state, log, retry: wait };
}

/**
 * A callback for every event the engine sends, for as long as the screen lives.
 *
 * The stream rather than polling, because a run that finishes should be
 * visible when it finishes. It reconnects on its own: the engine can be
 * restarted underneath, and a stream that gave up the first time would leave
 * the screen quietly stale, which is the failure nobody notices.
 */
export function useEngineEvents(ready: boolean, onEvent: () => void) {
  const latest = useRef(onEvent);
  latest.current = onEvent;

  useEffect(() => {
    if (!ready) return;
    const control = new AbortController();
    let stopped = false;

    (async () => {
      while (!stopped) {
        try {
          for await (const _ of events(control.signal)) {
            if (stopped) return;
            latest.current();
          }
        } catch {
          // Dropped, which on a phone is ordinary: the radio slept, the
          // process was reclaimed. Waiting a moment before trying again keeps
          // a permanently unreachable engine from becoming a busy loop.
        }
        if (stopped) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
    })();

    return () => {
      stopped = true;
      control.abort();
    };
  }, [ready]);
}
