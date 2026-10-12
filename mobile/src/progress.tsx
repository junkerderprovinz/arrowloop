import { useCallback, useEffect, useRef, useState } from "react";
import { speed as perSecond } from "../../web/src/lib/speed";
import type { Job, RunEvent } from "./api";
import { useT, type T } from "./i18n";
import { sidePair } from "./sides";
import { Caption, Meter } from "./ui";
import { useEngineStream } from "./useEngine";

/** How often stream updates reach the screen, in milliseconds. */
const DRAW_MS = 120;

export interface Progress {
  done: number;
  total: number;
  stage?: RunEvent["stage"];
  side?: string;
  guess?: boolean;
  /** Bytes a second, read from rclone's accounting; zero while nothing moves. */
  speed: number;
}

/**
 * How far each running job has got, from the event stream. Events collect in a
 * ref and reach state at most every DRAW_MS: a run over many small files sends
 * more than a hundred a second, and a render per event would leave the bars no
 * time to animate.
 */
export function useRunProgress(): Record<string, Progress> {
  const [shown, setShown] = useState<Record<string, Progress>>({});
  const heard = useRef<Record<string, Progress>>({});
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draw = useCallback(() => {
    pending.current = null;
    setShown({ ...heard.current });
  }, []);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  useEngineStream(true, (event) => {
    const was = heard.current[event.job];
    if (event.phase === "moving") {
      if (!was) return;
      heard.current[event.job] = { ...was, speed: event.speed ?? 0 };
    } else if (event.phase === "progress") {
      heard.current[event.job] = {
        done: event.done ?? 0,
        total: event.total ?? 0,
        stage: event.stage,
        side: event.side,
        guess: event.guess,
        speed: was?.speed ?? 0,
      };
    } else if (event.phase === "finished") {
      delete heard.current[event.job];
    } else {
      return;
    }
    if (!pending.current) pending.current = setTimeout(draw, DRAW_MS);
  });

  return shown;
}

/**
 * A running job's bar and one line under it. Before the first progress frame
 * the engine is still building its plan, and the line says so.
 */
export function RunProgress({ job, at, hue }: { job: Job; at?: Progress; hue: string }) {
  const { t, lang } = useT();
  if (!at) return <Caption>{t("preview.working")}</Caption>;
  const line = counted(at, t, lang);
  return (
    <>
      {at.stage ? <Caption>{stageLine(at.stage, at.side, job, t)}</Caption> : null}
      <Meter done={at.guess ? Math.min(at.done, at.total * 0.99) : at.done} total={at.total} hue={hue} />
      <Caption>{at.speed > 0 ? `${line} · ${perSecond(at.speed, lang)}` : line}</Caption>
    </>
  );
}

/**
 * How far a run has got, in words. A listing measured against the last run
 * reads "of about", and one with nothing to measure against only counts.
 */
function counted(at: Progress, t: T, lang: string): string {
  const format = new Intl.NumberFormat(lang);
  const done = format.format(at.done);
  const total = format.format(at.total);
  if (at.total > 0) return at.guess ? t("progress.about", { done, total }) : t("progress.of", { done, total });
  return at.stage ? t("progress.found", { done }) : t("progress.starting");
}

/**
 * The line that names a stage of reading a job. The web says which side by
 * left and right; here the side goes by its name.
 */
function stageLine(stage: NonNullable<RunEvent["stage"]>, side: string | undefined, job: Job, t: T): string {
  if (stage === "compare") return t("progress.compare");
  const place = sidePair(job.left, job.right, t)[side === "right" ? 1 : 0];
  return stage === "check" ? t("progress.checkPlace", { place }) : t("progress.listPlace", { place });
}
