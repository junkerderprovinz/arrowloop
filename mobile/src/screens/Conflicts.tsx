import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, EngineError, type Keep, type OpenConflict } from "../api";
import { useT, type TranslationKey } from "../i18n";
import { clock } from "../clock";
import { bytes } from "../space";
import { space } from "../theme";
import { useEngineStream } from "../useEngine";
import { conflictKey, decisionsByJob, newerSide } from "../../../web/src/lib/conflicts";
import { Badge, Body, Button, Caption, Card, Empty, Mono, Page, Pair, Toggle } from "../ui";

/** The same three answers, in the same order, as the web's conflicts tab. */
const CHOICES: { keep: Keep; key: TranslationKey }[] = [
  { keep: "both", key: "conflict.keepBoth" },
  { keep: "left", key: "conflict.keepLeft" },
  { keep: "right", key: "conflict.keepRight" },
];

/**
 * Every open conflict across the jobs, each with both versions and the three
 * answers, and the same answers for all the chosen ones at the foot.
 */
export function Conflicts() {
  const { t, lang } = useT();
  const [list, setList] = useState<OpenConflict[] | null>(null);
  const [unread, setUnread] = useState<{ job: string; error: string }[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const got = await api.conflicts();
      setList(got.conflicts);
      setUnread(got.unread);
      const live = new Set(got.conflicts.map(conflictKey));
      setChosen((old) => new Set([...old].filter((k) => live.has(k))));
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
    setBusy(false);
  };

  if (!list) return <Empty title={t("history.working")} detail={error || undefined} />;

  const picked = list.filter((c) => chosen.has(conflictKey(c)));

  return (
    <Page>
      {list.length === 0 ? <Empty title={t("conflicts.none")} /> : null}

      {list.map((c) => {
        const key = conflictKey(c);
        const newer = newerSide(c);
        return (
          <Card key={key}>
            <Mono>{c.plain}</Mono>
            <Caption>{`${c.job} · ${clock(c.at, lang)}`}</Caption>
            {(["left", "right"] as const).map((side) => (
              <View key={side} style={styles.version}>
                <Pair
                  label={t(side === "left" ? "edit.left" : "edit.right")}
                  value={`${bytes(c[side].size)} · ${clock(c[side].mod, lang)}`}
                />
                {newer === side ? <Badge label={t("conflict.newer")} tone="ok" /> : null}
              </View>
            ))}
            <View style={styles.choices}>
              {CHOICES.map(({ keep, key: label }) => (
                <Button
                  key={keep}
                  label={t(label)}
                  labelKey={label}
                  disabled={busy}
                  onPress={() => void decide([c], keep)}
                />
              ))}
            </View>
            <Toggle
              label={t("conflicts.select")}
              value={chosen.has(key)}
              onChange={(on) =>
                setChosen((old) => {
                  const next = new Set(old);
                  if (on) next.add(key);
                  else next.delete(key);
                  return next;
                })
              }
            />
          </Card>
        );
      })}

      {unread.map((u) => (
        <Caption key={u.job}>{t("conflicts.unread", { job: u.job, error: u.error })}</Caption>
      ))}
      {error ? <Body>{error}</Body> : null}

      {list.length > 0 ? (
        <Card>
          <Caption>{t("conflicts.chosen", { count: picked.length })}</Caption>
          <View style={styles.choices}>
            {CHOICES.map(({ keep, key }) => (
              <Button
                key={keep}
                label={t(key)}
                labelKey={key}
                busy={busy}
                disabled={picked.length === 0}
                onPress={() => void decide(picked, keep)}
              />
            ))}
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
