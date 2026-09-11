import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, type Action, type Plan as PlanType } from "../api";
import { useT } from "../i18n";
import type { JobsStack, Nav } from "../nav";
import { space } from "../theme";
import { Badge, Body, Button, Caption, Card, Empty, InfoBubble, Mono, Page, Title } from "../ui";

/**
 * What this job WOULD do, before it does any of it.
 *
 * The safety net the whole product is built around, and the one screen that
 * justifies a sync tool asking for access to every file on a phone. Nothing
 * here changes anything: it asks the engine for a plan and lists it.
 *
 * Grouped by KIND rather than listed flat. A hundred copies and one deletion
 * is a completely different plan from one copy and a hundred deletions, and a
 * flat list of a hundred and one rows says neither.
 */
export function Plan() {
  const route = useRoute<RouteProp<JobsStack, "Plan">>();
  const nav = useNavigation<Nav<JobsStack>>();
  const { t } = useT();
  const job = route.params.name;

  const [plan, setPlan] = useState<PlanType | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api.plan(job).then(setPlan, (e: Error) => setError(e.message));
  }, [job]);

  if (error) return <Empty title={t("error.unreachable")} detail={error} />;
  if (!plan) return <Empty title={t("preview.working")} detail={t("preview.for", { job })} />;

  const actions = plan.actions ?? [];
  const conflicts = actions.filter((a) => a.kind === "conflict");
  const rest = actions.filter((a) => a.kind !== "conflict");

  if (actions.length === 0) {
    return <Empty title={t("preview.nothing")} detail={t("preview.identical", { count: plan.unchanged })} />;
  }

  const groups = new Map<string, Action[]>();
  for (const action of rest) {
    const list = groups.get(action.kind) ?? [];
    list.push(action);
    groups.set(action.kind, list);
  }

  return (
    <Page>
      {/* What a preview IS, in the (i) beside the title rather than as a
          paragraph under it. The same rule the rest of the app follows now. */}
      <Card>
        <View style={styles.head}>
          <Title>{t("preview.for", { job })}</Title>
          <InfoBubble tip={t("phone.previewExplain")} />
        </View>
      </Card>

      {conflicts.length > 0 ? (
        <Card>
          <View style={styles.head}>
            <Title>{t("conflict.title")}</Title>
            <Badge label={String(conflicts.length)} tone="warn" />
            <InfoBubble tip={t("history.conflictHint")} />
          </View>
          {conflicts.slice(0, 30).map((action) => (
            <Mono key={action.path}>{action.path}</Mono>
          ))}
        </Card>
      ) : null}

      {[...groups.entries()].map(([kind, list]) => (
        <Card key={kind}>
          <View style={styles.head}>
            <Title>{t(kindKey(kind))}</Title>
            <Badge label={String(list.length)} />
          </View>
          {/* Thirty, and then a count. A phone that renders nine hundred rows
              of monospace is a phone that has stopped scrolling, and nobody
              reads past the first screen of a list like this anyway. */}
          {list.slice(0, 30).map((action) => (
            <Mono key={action.path}>{action.path}</Mono>
          ))}
          {list.length > 30 ? <Caption>{t("trash.more", { total: list.length, shown: 30 })}</Caption> : null}
        </Card>
      ))}

      {/* "Run now" rather than the desktop's "Run 5 of 12": there is nothing
          to tick here, so every action in the plan is going to happen and a
          count of chosen against total would be the same number twice. */}
      <Button
        label={t("jobs.runNow")}
        labelKey="jobs.runNow"
        tone="accent"
        busy={running}
        onPress={async () => {
          setRunning(true);
          try {
            await api.run(job);
            nav.goBack();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setRunning(false);
          }
        }}
      />
    </Page>
  );
}

function kindKey(kind: string): "kind.copy" | "kind.move" | "kind.delete" | "kind.mkdir" | "kind.rmdir" | "kind.conflict" {
  switch (kind) {
    case "copy":
      return "kind.copy";
    case "move":
      return "kind.move";
    case "trash":
    case "delete":
      return "kind.delete";
    case "mkdir":
      return "kind.mkdir";
    case "rmdir":
      return "kind.rmdir";
    default:
      return "kind.conflict";
  }
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
});
