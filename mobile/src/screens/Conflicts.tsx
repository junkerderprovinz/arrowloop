import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { api, EngineError, type Job, type Keep, type OpenConflict, type Remote } from "../api";
import { useT, type T, type TranslationKey } from "../i18n";
import { fullClock } from "../clock";
import { remoteOf, sidePair } from "../sides";
import { SideRow, sideMark } from "../sideRow";
import { bytes } from "../space";
import { space } from "../theme";
import { useEngineStream } from "../useEngine";
import { conflictKey, decisionsByJob, newerSide } from "../../../web/src/lib/conflicts";
import { failureLine, type Failure } from "../../../web/src/lib/failure";
import { AxisLabel, Badge, Body, Button, Caption, Card, Empty, Mono, Page, Pair } from "../ui";
import { useWaiting } from "../waiting";

/** The same three answers, in the same order, as the web's conflicts page. */
const CHOICES: Keep[] = ["both", "left", "right"];

/** The glyph of each answer, the same for one conflict and for all of them. */
const GLYPH: Record<Keep, string> = { both: "IconKeepBoth", left: "IconKeepLeft", right: "IconKeepRight" };

/** What the engine says caused a conflict, in a sentence, keyed by its reason code. */
const WHY: Record<string, TranslationKey> = {
  changedBoth: "conflict.why.changedBoth",
  appearedDiffer: "conflict.why.appearedDiffer",
};

/**
 * An answer's words, which say what it does to which version. A side goes by
 * what it is, the way the job card names it: this phone, a target, or, where
 * both sides are folders on the phone, the folder.
 */
function keepLabel(keep: Keep, job: Job | undefined, t: T): string {
  if (keep === "both") return t("conflict.answerBoth");
  const path = (keep === "left" ? job?.left : job?.right) ?? "";
  const name = sidePair(job?.left, job?.right, t)[keep === "left" ? 0 : 1];
  if (remoteOf(path)) return t("conflict.keepOnPlace", { place: name });
  if (name === t("side.onDevice")) return t("conflict.keepOnPhone");
  return t("conflict.keepInFolder", { place: name });
}

/**
 * Every open conflict across the jobs, each saying which file it is, what went
 * wrong and what each side holds, with the three answers under it. From two
 * conflicts up, the same answers for all of them stand at the foot and ask
 * first.
 */
export function Conflicts() {
  const { t, lang } = useT();
  const [list, setList] = useState<OpenConflict[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [unread, setUnread] = useState<{ job: string; error: string; failure?: Failure }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const waiting = useWaiting();

  const load = useCallback(async () => {
    try {
      const [got, known] = await Promise.all([api.conflicts(), api.jobs()]);
      setJobs(known);
      setList(got.conflicts);
      setUnread(got.unread);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    api.storage().then((found) => setRemotes(found.remotes), () => {});
  }, [load]);
  useEngineStream(true, (event) => {
    if (event.phase === "finished") void load();
  });

  const decide = async (rows: OpenConflict[], keep: Keep) => {
    setBusy(true);
    setError("");
    for (const [job, decisions] of decisionsByJob(rows, keep)) {
      try {
        const { run } = await api.decide(job, decisions);
        if (run.Skipped > 0) setError(t("conflicts.skipped", { count: run.Skipped }));
      } catch (e) {
        setError(e instanceof EngineError && e.status === 409 ? t("conflicts.running", { job }) : (e as Error).message);
      }
    }
    await load();
    waiting.refresh();
    setBusy(false);
  };

  if (!list) return <Empty title={t("history.working")} detail={error || undefined} />;

  // The answer for all of them names a side by position, which only reads
  // true when every conflict belongs to one job.
  const single = new Set(list.map((c) => c.job)).size === 1 ? jobs.find((j) => j.name === list[0]?.job) : undefined;

  return (
    <Page>
      {list.length === 0 ? <Empty title={t("conflicts.none")} /> : null}

      {list.map((c) => {
        const job = jobs.find((j) => j.name === c.job);
        const newer = newerSide(c);
        return (
          <Card key={conflictKey(c)}>
            <Mono>{c.plain}</Mono>
            <Caption>{c.job}</Caption>
            <Body>{t(WHY[c.why ?? ""] ?? "conflict.why.unknown")}</Body>
            {(["left", "right"] as const).map((side) => (
              <View key={side} style={styles.side}>
                <View style={styles.sideHead}>
                  <AxisLabel>{t(side === "left" ? "edit.left" : "edit.right")}</AxisLabel>
                  {newer === side ? <Badge label={t("conflict.newer")} tone="ok" /> : null}
                </View>
                {job ? <SideRow path={job[side]} mark={sideMark(job[side], remotes)} /> : null}
                <Pair label={t("conflict.size")} value={bytes(c[side].size)} />
                <Pair label={t("conflict.changed")} value={fullClock(c[side].mod, lang)} />
                <Pair label={t("conflict.namedNow")} value={c[side].path.split("/").pop() ?? c[side].path} />
              </View>
            ))}
            <View style={styles.choices}>
              {CHOICES.map((keep) => (
                <Button key={keep} label={keepLabel(keep, job, t)} glyph={GLYPH[keep]} disabled={busy} onPress={() => void decide([c], keep)} />
              ))}
            </View>
          </Card>
        );
      })}

      {unread.map((u) => (
        <Caption key={u.job}>{t("conflicts.unread", { job: u.job, error: failureLine(u.error, u.failure, t, lang) })}</Caption>
      ))}
      {error ? <Body>{error}</Body> : null}

      {list.length > 1 ? (
        <Card>
          <Caption>{t("conflicts.allConfirm", { count: list.length })}</Caption>
          <View style={styles.choices}>
            {CHOICES.filter((keep) => keep === "both" || single).map((keep) => {
              const label = keep === "both" ? t("conflicts.allBoth") : keepLabel(keep, single, t);
              return (
                <Button
                  key={keep}
                  label={label}
                  glyph={GLYPH[keep]}
                  busy={busy}
                  onPress={() =>
                    Alert.alert(label, `${t("conflicts.allConfirm", { count: list.length })} ${t("conflicts.chooseHint")}`, [
                      { text: t("confirm.cancel"), style: "cancel" },
                      { text: label, onPress: () => void decide(list, keep) },
                    ])
                  }
                />
              );
            })}
          </View>
        </Card>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  side: {
    gap: space.xs,
  },
  sideHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  choices: {
    gap: space.sm,
  },
});
