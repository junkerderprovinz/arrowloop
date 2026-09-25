import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { actionName } from "../../../web/src/lib/actionName";
import { api, type Action, type Plan as PlanType } from "../api";
import { useT } from "../i18n";
import type { JobsStack, Nav } from "../nav";
import { space } from "../theme";
import { Badge, Body, Button, Caption, Card, Empty, InfoBubble, Mono, Page, Title } from "../ui";

/**
 * Lists what a job would do without changing anything. Actions are grouped by
 * kind, since a hundred copies and one deletion is a different plan from the
 * reverse.
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
            <Mono key={action.path}>{actionName(action)}</Mono>
          ))}
        </Card>
      ) : null}

      {[...groups.entries()].map(([kind, list]) => (
        <Card key={kind}>
          <View style={styles.head}>
            <Title>{t(kindKey(kind))}</Title>
            <Badge label={String(list.length)} />
          </View>
          {/* Capped, since hundreds of monospace rows stall the scroll. */}
          {list.slice(0, 30).map((action) => (
            <Mono key={action.path}>{actionName(action)}</Mono>
          ))}
          {list.length > 30 ? <Caption>{t("trash.more", { total: list.length, shown: 30 })}</Caption> : null}
        </Card>
      ))}

      {/* Nothing can be deselected here, so the desktop's "Run 5 of 12" count
          would always show the same number twice. */}
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
