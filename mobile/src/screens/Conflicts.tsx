import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { api, EngineError, type Job, type Keep, type OpenConflict } from "../api";
import { useT, type T } from "../i18n";
import { clock } from "../clock";
import { jobSides } from "../sides";
import { bytes } from "../space";
import { space } from "../theme";
import { useEngineStream } from "../useEngine";
import { conflictKey, decisionsByJob, newerSide } from "../../../web/src/lib/conflicts";
import { Badge, Body, Button, Caption, Card, Empty, Mono, Page, Pair } from "../ui";
import { useWaiting } from "../waiting";

/** The same three answers, in the same order, as the web's conflicts tab. */
const CHOICES: Keep[] = ["both", "left", "right"];

/**
 * An answer's words. The web says left and right, which name nothing on a
 * screen that shows the two sides under each other, so a side goes by its name.
 */
function keepLabel(keep: Keep, [left, right]: [string, string], t: T): string {
  if (keep === "both") return t("conflict.keepBoth");
  return t("conflict.keepPlace", { place: keep === "left" ? left : right });
}

/**
 * Every open conflict across the jobs, each with both versions and the three
 * answers, and the same answers for all of them at the foot, which ask first.
 */
export function Conflicts() {
  const { t, lang } = useT();
  const [list, setList] = useState<OpenConflict[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [unread, setUnread] = useState<{ job: string; error: string }[]>([]);
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

  // The answer for all of them can only name a side they share. Jobs with
  // different sides leave "keep both", and the rest is decided per card.
  const pairs = list.map((c) => jobSides(jobs, c.job, t));
  const shared = pairs.every(([l, r]) => l === pairs[0]?.[0] && r === pairs[0]?.[1]) ? pairs[0] : undefined;

  return (
    <Page>
      {list.length === 0 ? <Empty title={t("conflicts.none")} /> : null}

      {list.map((c) => {
        const key = conflictKey(c);
        const newer = newerSide(c);
        const sides = jobSides(jobs, c.job, t);
        return (
          <Card key={key}>
            <Mono>{c.plain}</Mono>
            <Caption>{`${c.job} · ${clock(c.at, lang)}`}</Caption>
            {(["left", "right"] as const).map((side) => (
              <View key={side} style={styles.version}>
                <Pair
                  label={sides[side === "left" ? 0 : 1]}
                  value={`${bytes(c[side].size)} · ${clock(c[side].mod, lang)}`}
                />
                {newer === side ? <Badge label={t("conflict.newer")} tone="ok" /> : null}
              </View>
            ))}
            <View style={styles.choices}>
              {CHOICES.map((keep) => (
                <Button
                  key={keep}
                  label={keepLabel(keep, sides, t)}
                  disabled={busy}
                  onPress={() => void decide([c], keep)}
                />
              ))}
            </View>
          </Card>
        );
      })}

      {unread.map((u) => (
        <Caption key={u.job}>{t("conflicts.unread", { job: u.job, error: u.error })}</Caption>
      ))}
      {error ? <Body>{error}</Body> : null}

      {list.length > 0 ? (
        <Card>
          <Caption>{t("conflicts.allConfirm", { count: list.length })}</Caption>
          <View style={styles.choices}>
            {CHOICES.filter((keep) => keep === "both" || shared).map((keep) => {
              const label = shared ? keepLabel(keep, shared, t) : t("conflict.keepBoth");
              return (
                <Button
                  key={keep}
                  label={label}
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
  version: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  choices: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: space.sm,
  },
});
