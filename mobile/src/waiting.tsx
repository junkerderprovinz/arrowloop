import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Finding } from "../../web/src/lib/anomalies";
import { coalesce } from "../../web/src/lib/coalesce";
import { trashTotals } from "../../web/src/lib/trashView";
import { api } from "./api";
import { settings } from "./settings";
import { useEngineStream } from "./useEngine";

/**
 * What waits across every job, asked for once so the bar, the More sheet and
 * the head of the job list show the same numbers. Null until the engine has
 * answered.
 */
export interface Waiting {
  running: number | null;
  conflicts: number | null;
  /** The jobs with a conflict waiting for an answer. */
  conflicted: string[] | null;
  findings: Finding[] | null;
  /** Files in the trash of every job's two sides. */
  trash: number | null;
  /** What those files take up, in bytes. */
  trashBytes: number | null;
  /** Whether the anomaly notes and their screen are switched on. */
  anomaliesOn: boolean | null;
  /** Asks again, after something on screen changed one of the counts. */
  refresh: () => void;
}

const Ctx = createContext<Waiting>({
  running: null,
  conflicts: null,
  conflicted: null,
  findings: null,
  trash: null,
  trashBytes: null,
  anomaliesOn: null,
  refresh: () => {},
});

// The conflicts and the trash are read from every side, so a target that hangs
// keeps each question out for as long as the engine waits, and every question
// out holds one of the connections that the screens' own requests then queue
// behind. One of each at a time, then, shared by every mount of the provider,
// which mounts again whenever the app waits for the engine. The last counts
// stay meanwhile.
let showConflicts: (got: Awaited<ReturnType<typeof api.conflicts>>) => void = () => {};
let showTrash: (got: Awaited<ReturnType<typeof api.trashAll>>) => void = () => {};
const askConflicts = coalesce(() => api.conflicts().then((got) => showConflicts(got)), 0);
const askTrash = coalesce(() => api.trashAll().then((got) => showTrash(got)), 0);

export function WaitingProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState<number | null>(null);
  const [conflicted, setConflicted] = useState<string[] | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [trash, setTrash] = useState<number | null>(null);
  const [trashBytes, setTrashBytes] = useState<number | null>(null);
  const [anomaliesOn, setAnomaliesOn] = useState<boolean | null>(null);

  useEffect(() => {
    showConflicts = (got) => {
      setConflicts(got.conflicts.length);
      setConflicted([...new Set(got.conflicts.map((c) => c.job))]);
    };
    showTrash = (got) => {
      const totals = trashTotals(got.sides.filter((s) => !s.error));
      setTrash(totals.entries);
      setTrashBytes(totals.bytes);
    };
  }, []);

  // Each count lands on its own, so a slow trash listing holds up nothing.
  const refresh = useCallback(() => {
    api.jobs().then((jobs) => setRunning(jobs.filter((j) => j.running).length), () => {});
    askConflicts();
    api.anomalies().then((got) => setFindings(got.open), () => {});
    askTrash();
    settings.read().then(
      (got) => setAnomaliesOn((got.anomalies as { off?: boolean } | undefined)?.off !== true),
      () => {},
    );
  }, []);

  // Asked again whenever the stream connects, the first time included, and
  // whenever the app comes back to the front: the engine works on while the
  // app is away, and nothing it did then reaches the stream.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => next === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);
  // A run starting or ending is what changes these; progress frames change none.
  useEngineStream(
    true,
    (event) => {
      if (event.phase === "started" || event.phase === "finished" || event.phase === "anomaly") refresh();
    },
    refresh,
  );

  const value = useMemo(
    () => ({ running, conflicts, conflicted, findings, trash, trashBytes, anomaliesOn, refresh }),
    [running, conflicts, conflicted, findings, trash, trashBytes, anomaliesOn, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWaiting(): Waiting {
  return useContext(Ctx);
}
