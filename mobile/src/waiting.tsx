import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Finding } from "../../web/src/lib/anomalies";
import { trashTotals } from "../../web/src/lib/trashView";
import { api } from "./api";
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
  /** How many conflict lists could not be read, which may hide one waiting. */
  unread: number | null;
  findings: Finding[] | null;
  /** Files in the trash of every job's two sides. */
  trash: number | null;
  /** Asks again, after something on screen changed one of the counts. */
  refresh: () => void;
}

const Ctx = createContext<Waiting>({
  running: null,
  conflicts: null,
  conflicted: null,
  unread: null,
  findings: null,
  trash: null,
  refresh: () => {},
});

export function WaitingProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState<number | null>(null);
  const [conflicted, setConflicted] = useState<string[] | null>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [trash, setTrash] = useState<number | null>(null);

  // Each count lands on its own, so a slow trash listing holds up nothing.
  const refresh = useCallback(() => {
    api.jobs().then((jobs) => setRunning(jobs.filter((j) => j.running).length), () => {});
    api.conflicts().then(
      (got) => {
        setConflicts(got.conflicts.length);
        setConflicted([...new Set(got.conflicts.map((c) => c.job))]);
        setUnread(got.unread.length);
      },
      () => {},
    );
    api.anomalies().then((got) => setFindings(got.open), () => {});
    api.trashAll().then((got) => setTrash(trashTotals(got.sides.filter((s) => !s.error)).entries), () => {});
  }, []);

  useEffect(refresh, [refresh]);
  // A run starting or ending is what changes these; progress frames change none.
  useEngineStream(true, (event) => {
    if (event.phase === "started" || event.phase === "finished" || event.phase === "anomaly") refresh();
  });

  const value = useMemo(
    () => ({ running, conflicts, conflicted, unread, findings, trash, refresh }),
    [running, conflicts, conflicted, unread, findings, trash, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWaiting(): Waiting {
  return useContext(Ctx);
}
