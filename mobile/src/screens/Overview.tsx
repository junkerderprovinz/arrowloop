import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, type Job, type Remote, type RunEvent, type Usage } from "../api";
import { Glyph } from "../glyphs";
import { useT } from "../i18n";
import { space } from "../theme";
import { useEngineStream } from "../useEngine";
import { Badge, Body, Caption, Card, CardHead, Empty, Meter, Mono, Page, Title, useHue, useTheme } from "../ui";
import { entryKey } from "./History";
import { bytes } from "./Targets";

/**
 * What is happening right now, and what it is happening to.
 *
 * jdp: "In Autosync gibt es eine Übersichtsseite wo man schön sieht was gerade
 * läuft (welcher auftrag und welche dateien grade hoch oder runter geladen
 * werden, mit Progressbar) und welche konten verbunden sind inkl. wie viel
 * speicher auf den konten verbraucht ist/frei ist. Das hätte ich auch gerne."
 *
 * Two questions, in that order, and neither of them is answered anywhere else in
 * the app: the job list says a job is running and not what it is doing, and the
 * targets list stopped showing how full anything is when the check button moved
 * into the form.
 *
 * THE LIVE HALF IS DRAWN FROM THE EVENT STREAM, never from polling. The engine
 * publishes a line per file with the count and the total, and the total is known
 * before the first byte moves. Asking again on a timer would show every fourth
 * file at best, and a bar that jumps in fours is worse than no bar - it looks
 * like the transfer is stalling.
 */
export function Overview() {
  const { t } = useT();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [live, setLive] = useState<Record<string, Progress>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setJobs(await api.jobs());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The stream keeps the PROGRESS; the job list keeps the roster. A run that
  // started before this screen opened has no progress line yet, and the list is
  // what says it is running at all - so the two are held apart rather than one
  // being derived from the other.
  useEngineStream(true, (event: RunEvent) => {
    if (event.phase === "progress") {
      setLive((old) => ({
        ...old,
        [event.job]: {
          done: event.done ?? 0,
          total: event.total ?? 0,
          kind: event.kind ?? "",
          path: event.path ?? "",
          side: event.side ?? "",
        },
      }));
      return;
    }
    // Started and finished both change the roster, so both go and ask. The
    // progress is dropped on the way out: a bar left at 98% under a job that
    // ended an hour ago is a lie that nothing later corrects.
    if (event.phase === "finished") {
      setLive((old) => {
        const next = { ...old };
        delete next[event.job];
        return next;
      });
    }
    void load();
  });

  const running = useMemo(() => (jobs ?? []).filter((j) => j.running), [jobs]);

  if (!jobs) return <Empty title={t("history.working")} detail={error || undefined} />;

  return (
    <Page>
      <Title>{t("overview.running")}</Title>
      {running.length === 0 ? (
        <Card>
          <Body>{t("overview.idle")}</Body>
          <Caption>{t("overview.idleHint")}</Caption>
        </Card>
      ) : (
        running.map((job, index) => <Running key={job.name} job={job} at={live[job.name]} index={index} />)
      )}

      <Title>{t("overview.accounts")}</Title>
      <Accounts />

      {error ? <Caption>{error}</Caption> : null}
    </Page>
  );
}

/** Where one running job has got to, as the stream last said. */
interface Progress {
  done: number;
  total: number;
  kind: string;
  path: string;
  side: string;
}

/**
 * One job that is running: how far, and on which file.
 *
 * The path is the line somebody actually watches, so it gets the monospace and
 * the room to wrap. The count under the bar is the same fact in numbers, which
 * is what a bar cannot give: "941 of 12000" says how long this will take and a
 * bar at eight percent does not.
 */
function Running({ job, at, index }: { job: Job; at?: Progress; index: number }) {
  const { t } = useT();
  const { p } = useTheme();
  const hue = useHue(index);
  return (
    <Card hue={hue}>
      <View style={styles.head}>
        <Title>{job.name}</Title>
        <Badge label={t("jobs.state.running")} tone="accent" />
      </View>
      {at ? (
        <>
          {/* What is moving, and which way. The side is the one the work LANDS
              on, which is the same fact as the direction of this file: a file
              that arrived on the right came from the left. */}
          <View style={styles.line}>
            <Badge label={t(entryKey(at.kind))} />
            {at.side === "left" || at.side === "right" ? (
              <Glyph name={at.side === "left" ? "IconToLeft" : "IconToRight"} color={p.textSub} size={16} />
            ) : null}
          </View>
          {at.path ? <Mono>{at.path}</Mono> : null}
          <Meter done={at.done} total={at.total} hue={hue} />
          <Caption>{t("progress.of", { done: at.done, total: at.total })}</Caption>
        </>
      ) : (
        // Running, with nothing said yet. That is a real state and a common
        // one: the engine builds the plan before it moves a byte, and on a big
        // pair of folders that is where most of a short run is spent.
        <Caption>{t("preview.working")}</Caption>
      )}
    </Card>
  );
}

/**
 * Every target, and how full it is.
 *
 * ONE REQUEST PER TARGET, each on its own, because that is what the engine
 * offers: `about` is a live question asked of the service. They are fired
 * together and land as they land - a cloud that takes four seconds to answer
 * must not hold up the three that answered instantly.
 *
 * A target that cannot be reached says so here, which is the other half of what
 * jdp asked for: "welche konten verbunden sind". A list that quietly omitted a
 * broken one would answer the question wrongly and look complete doing it.
 */
function Accounts() {
  const { t } = useT();
  const [remotes, setRemotes] = useState<Remote[] | null>(null);
  const [room, setRoom] = useState<Record<string, Usage | "gone">>({});

  useEffect(() => {
    let live = true;
    api.storage().then(
      (storage) => {
        if (!live) return;
        setRemotes(storage.remotes);
        for (const remote of storage.remotes) {
          api.aboutRemote(remote.name).then(
            (usage) => live && setRoom((old) => ({ ...old, [remote.name]: usage })),
            // Unreachable, refused, or a backend with no such question. The
            // card says which of those it was as far as it can: `about` fails
            // for a target that cannot be reached, and answers
            // `supported: false` for one that can be reached and does not
            // count.
            () => live && setRoom((old) => ({ ...old, [remote.name]: "gone" })),
          );
        }
      },
      () => live && setRemotes([]),
    );
    return () => {
      live = false;
    };
  }, []);

  if (!remotes) return <Card><Caption>{t("history.working")}</Caption></Card>;
  if (remotes.length === 0) {
    return (
      <Card>
        <Body>{t("targets.storageEmpty")}</Body>
      </Card>
    );
  }

  return (
    <>
      {remotes.map((remote, index) => (
        <Account key={remote.name} remote={remote} usage={room[remote.name]} index={index} />
      ))}
    </>
  );
}

function Account({
  remote,
  usage,
  index,
}: {
  remote: Remote;
  usage: Usage | "gone" | undefined;
  index: number;
}) {
  const { t } = useT();
  const hue = useHue(index);

  // `total` is what the service says it has, and `used` what it says is gone.
  // A backend that reports only one of the two is ordinary - an S3 bucket has
  // no size at all - so every line below is drawn from what is actually there
  // rather than from a total that was assumed and then divided by.
  const usable = usage && usage !== "gone" && usage.supported ? usage : null;
  const total = usable?.total ?? 0;
  const used = usable?.used ?? (total && usable?.free !== undefined ? total - usable.free : 0);

  return (
    <Card hue={hue}>
      <CardHead mark={remote.mark} title={remote.name}>
        {usage === "gone" ? (
          <View style={styles.badgeSlot}>
            <Badge label={t("targets.checkFailed")} tone="fail" />
          </View>
        ) : null}
      </CardHead>
      {usable ? (
        <>
          {total > 0 ? <Meter done={used} total={total} hue={hue} /> : null}
          <Caption>
            {total > 0 && usable.free !== undefined
              ? t("targets.spaceFree", { free: bytes(usable.free), total: bytes(total) })
              : used > 0
                ? t("targets.spaceUsed", { used: bytes(used) })
                : total > 0
                  ? t("targets.spaceTotal", { total: bytes(total) })
                  : t("overview.noSpace")}
          </Caption>
        </>
      ) : usage === undefined ? (
        <Caption>{t("history.working")}</Caption>
      ) : usage === "gone" ? null : (
        // Reached, and it does not count. Said plainly rather than shown as an
        // empty bar, which would read as "completely empty".
        <Caption>{t("overview.noSpace")}</Caption>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  badgeSlot: { marginStart: "auto" },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
