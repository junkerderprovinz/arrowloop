import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, events, type RunEvent } from "./api";
import { engine } from "./engine";
import type { T } from "./i18n";

export type EngineState = "starting" | "ready" | "trouble";

/**
 * How long to wait for the engine to answer after starting it. A deadline
 * rather than an attempt count, since each attempt carries its own timeout;
 * a cold start pages in a 79 MB binary.
 */
const WAIT_MS = 60_000;

const HEAD_LINES = 8;

/**
 * Cuts the log to its first lines plus the last one. A Go crash writes its
 * reason first and then hundreds of lines of goroutines and registers.
 */
function readable(text: string): string {
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return "(the log is empty: the engine wrote nothing at all)";
  if (lines.length <= HEAD_LINES + 1) return lines.join("\n");
  return [...lines.slice(0, HEAD_LINES), "…", lines[lines.length - 1]].join("\n");
}

/**
 * Starts the engine and reports when it answers; screens fetch nothing before
 * that.
 */
export function useEngine(t: T) {
  const [state, setState] = useState<EngineState>("starting");
  const [log, setLog] = useState("");

  // Keeps asking after the deadline, so a busy engine clears the trouble
  // screen on its own once it answers.
  const keepKnocking = useCallback(() => {
    let stopped = false;
    const knock = async () => {
      while (!stopped) {
        await new Promise((r) => setTimeout(r, 3000));
        if (stopped) return;
        if (await api.alive()) {
          setState("ready");
          return;
        }
      }
    };
    void knock();
    return () => {
      stopped = true;
    };
  }, []);

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
    console.log(`[arrowloop] gave up after ${asked} attempts in ${Date.now() - (until - WAIT_MS)}ms`);
    // An empty log means either a dead or a busy engine; only the process can
    // tell which.
    const [text, alive] = await Promise.all([engine.log(), engine.alive()]);
    setLog((alive ? t("phone.engineBusy") : t("phone.engineGone")) + "\n\n" + readable(text));
    setState("trouble");
    if (alive) keepKnocking();
  }, [keepKnocking, t]);

  useEffect(() => {
    if (!engine.available) {
      setLog(t("phone.engineNoModule"));
      setState("trouble");
      return;
    }
    // The deadline starts now rather than when start() resolves, since that
    // native call can hang; its result matters only when it fails.
    void wait();
    engine.start().catch((e: Error) => setLog((old) => `${e.message}\n\n${old}`));
  }, [wait, t]);

  // Android may have reclaimed the service while the app was in the background.
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
 * Calls onEvent for every engine event that can change what a list shows.
 */
export function useEngineEvents(ready: boolean, onEvent: () => void) {
  useEngineStream(ready, (event) => {
    // Progress frames arrive twice a second and change no list.
    if (event.phase === "moving") return;
    onEvent();
  });
}

/**
 * Subscribes to the engine's event stream, reconnecting whenever it drops.
 * A frame that does not parse is skipped.
 */
export function useEngineStream(ready: boolean, onEvent: (event: RunEvent) => void) {
  const latest = useRef(onEvent);
  latest.current = onEvent;

  useEffect(() => {
    if (!ready) return;
    const control = new AbortController();
    let stopped = false;

    (async () => {
      while (!stopped) {
        try {
          for await (const line of events(control.signal)) {
            if (stopped) return;
            let event: RunEvent;
            try {
              event = JSON.parse(line) as RunEvent;
            } catch {
              continue;
            }
            latest.current(event);
          }
        } catch {
          // Dropped connections are ordinary on a phone; the pause below
          // keeps an unreachable engine from turning this into a busy loop.
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
