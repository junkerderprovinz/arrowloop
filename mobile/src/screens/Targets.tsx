import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { api, type Remote, type Usage } from "../api";
import { useT } from "../i18n";
import type { Nav, TargetsStack } from "../nav";
import { space } from "../theme";
import { Badge, Body, Button, Caption, Card, Empty, Fab, Floating, Page, Title, useHue } from "../ui";

/**
 * The storage this phone can reach.
 *
 * A job's right-hand side is usually `something:path`, and `something` is
 * configured here. Without this screen the app can only sync two folders on
 * the phone itself, which is not what anybody installs a sync tool for.
 *
 * Each target says whether it ANSWERS, and how full it is where the service
 * will say. A target that was saved and cannot be reached is the commonest
 * failure by a distance, and finding that out when a job runs at three in the
 * morning is finding out too late.
 */
export function Targets() {
  const nav = useNavigation<Nav<TargetsStack>>();
  const { t } = useT();
  const [remotes, setRemotes] = useState<Remote[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRemotes((await api.storage()).remotes);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const stop = nav.addListener("focus", load);
    return stop;
  }, [nav, load]);

  if (!remotes) return <Empty title={t("history.working")} detail={error || undefined} />;

  return (
    <Floating>
      <Page fab>
      {/* Nothing where there is nothing. jdp asked for the hint text to go when
          the page is empty, and the floating button below carries the offer. */}
      {remotes.map((remote, index) => (
        <TargetCard
          key={remote.name}
          remote={remote}
          index={index}
          onEdit={() => nav.navigate("TargetEdit", { name: remote.name })}
          onGone={load}
        />
      ))}

      {error ? <Caption>{error}</Caption> : null}
      </Page>
      {/* Bottom right, the same place the job list keeps its own. */}
      <Fab
        label={t("targets.addStorage")}
        labelKey="targets.addStorage"
        onPress={() => nav.navigate("TargetPick")}
      />
    </Floating>
  );
}

function TargetCard({
  remote,
  index,
  onEdit,
  onGone,
}: {
  remote: Remote;
  index: number;
  onEdit: () => void;
  onGone: () => void;
}) {
  const { t } = useT();
  const hue = useHue(index);
  const [state, setState] = useState<"unknown" | "checking" | "ok" | "bad">("unknown");
  const [detail, setDetail] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);

  const check = async () => {
    setState("checking");
    try {
      const result = await api.checkRemote(remote.name);
      if (result.ok) {
        setState("ok");
        setDetail("");
        // Space only AFTER it answers: asking a target that is not reachable
        // how full it is produces a second error about the same thing.
        api.aboutRemote(remote.name).then(setUsage, () => setUsage(null));
      } else {
        setState("bad");
        setDetail(result.reason ?? "");
      }
    } catch (e) {
      setState("bad");
      setDetail((e as Error).message);
    }
  };

  // The same three-way the desktop uses, and in the same order: free space is
  // the number somebody is actually asking about, used is the consolation
  // prize, and a total on its own at least says the service answered. A
  // service that reports none of the three gets no line rather than a zero.
  const room = (() => {
    if (!usage?.supported) return null;
    const total = usage.total;
    const used =
      usage.used ?? (total !== undefined && usage.free !== undefined ? total - usage.free : undefined);
    if (usage.free !== undefined && total !== undefined) {
      return t("targets.spaceFree", { free: bytes(usage.free), total: bytes(total) });
    }
    if (used !== undefined) return t("targets.spaceUsed", { used: bytes(used) });
    if (total !== undefined) return t("targets.spaceTotal", { total: bytes(total) });
    return null;
  })();

  const remove = () => {
    Alert.alert(t("confirm.deleteRemote"), t("confirm.deleteRemoteStakes", { name: remote.name }), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("confirm.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteRemote(remote.name);
            onGone();
          } catch (e) {
            setDetail((e as Error).message);
          }
        },
      },
    ]);
  };

  return (
    <Card hue={hue}>
      <View style={styles.head}>
        <Title>{remote.name}</Title>
        {state === "ok" ? (
          <Badge label={t("targets.checkOk")} tone="ok" />
        ) : state === "bad" ? (
          <Badge label={t("targets.checkFailed")} tone="fail" />
        ) : null}
      </View>
      <Caption>{remote.type}</Caption>

      {room ? <Body>{room}</Body> : null}
      {detail ? <Body>{detail}</Body> : null}

      <View style={styles.actions}>
        <Button
          label={state === "checking" ? t("targets.checking") : t("targets.check")}
          busy={state === "checking"}
          onPress={check}
        />
        <Button label={t("targets.edit")} labelKey="targets.edit" onPress={onEdit} />
        <Button label={t("targets.delete")} labelKey="targets.delete" tone="danger" onPress={remove} wide={false} />
      </View>
    </Card>
  );
}

/** Bytes as somebody would say them. */
export function bytes(n: number | undefined): string {
  if (n === undefined) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  actions: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
});
