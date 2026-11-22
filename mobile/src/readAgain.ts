type Off = () => void;

/**
 * What tells a screen that what it shows may be old. Each one subscribes and
 * returns how to stop; a screen passes the ones that concern it.
 */
export interface Cues {
  /** The screen coming into view, such as back from another tab. */
  focus?: (read: () => void) => Off;
  /** The app coming back to the front. Android freezes it while it is away, and the engine works on. */
  front?: (read: () => void) => Off;
  /** The engine's events, and the stream connecting, the first time included. */
  stream?: (onEvent: (event: { phase?: string }) => void, onOpen: () => void) => Off;
  now?: () => number;
  after?: (ms: number, run: () => void) => Off;
}

/** A run sends an event per file, so its events read again at most this often. */
const EVENT_GAP_MS = 1000;

/** Has `read` called on every cue, and returns how to stop. */
export function follow(cues: Cues, read: () => void): Off {
  const now = cues.now ?? Date.now;
  const after =
    cues.after ??
    ((ms: number, run: () => void) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  let last = -Infinity;
  let pending: Off | null = null;
  const onEvent = (event: { phase?: string }) => {
    // Progress frames come twice a second and change no list.
    if (event.phase === "moving" || event.phase === "group") return;
    if (now() - last >= EVENT_GAP_MS) {
      last = now();
      read();
      return;
    }
    // A trailing read, so the last event of a burst is not dropped.
    pending ??= after(EVENT_GAP_MS, () => {
      pending = null;
      last = now();
      read();
    });
  };
  const offs = [cues.focus?.(read), cues.front?.(read), cues.stream?.(onEvent, read)].filter(
    (off): off is Off => off !== undefined,
  );
  return () => {
    pending?.();
    for (const off of offs) off();
  };
}
