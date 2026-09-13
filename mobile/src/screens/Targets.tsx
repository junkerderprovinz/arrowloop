import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { api, type Remote, type Usage } from "../api";
import { useT } from "../i18n";
import type { Nav, TargetsStack } from "../nav";
import { space } from "../theme";
import { Badge, Body, Button, Caption, Card, CardHead, Empty, Fab, Floating, Page, useHue, useTheme } from "../ui";
import { CardMenu } from "../CardMenu";

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
  const { p, scheme } = useTheme();
  const hue = useHue(index);
  // No reachable/unreachable state here any more. The button that set it moved
  // to the form (jdp: "der pruefen button der ziele soll in ziele einrichten
  // seite nicht auf die card"), and a badge nothing can ever light is worse than
  // no badge: an empty card reads as "not checked yet" when in truth nothing on
  // this screen can check it. The space reading went the same way - it was only
  // ever fetched after a successful check.

  /** Only for something that went wrong HERE, which is a failed delete. */
  const [detail, setDetail] = useState("");

  const remove = () => {
    Alert.alert(t("confirm.deleteRemote"), t("confirm.deleteRemoteStakes", { name: remote.name }), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("confirm.delete"),
        // Not "destructive": GlimStone 1.12.0 paints no delete red, and
        // the platform dialog is no exception to a rule about deletes.
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
      {/* The same head the job list draws, from the same component - see
          CardHead in ui.tsx. A target names its product directly, so there is no
          side to resolve first. */}
      <CardHead mark={remote.mark} title={remote.name}>
        {/* The two rare acts, out of the row and into a menu, the same way the
            job card does it. jdp: "auch in den ziele card ein hamburgermenue."
            Three buttons of equal weight said all three were equally likely,
            and two of them are things somebody does once. */}
        <View style={styles.menuSlot}>
          <CardMenu
            items={[
              { label: t("action.edit"), glyph: "IconEdit", onPress: onEdit },
              { label: t("action.delete"), glyph: "IconDelete", onPress: remove },
            ]}
          />
        </View>
      </CardHead>
      {/* The protocol, only where the logo did not already say it. jdp: "die
          verbindungsart kannst du auf der ziele card weg lassen" - and under a
          Garage mark, `s3` says the same thing twice and less clearly. Kept
          for a target no provider claims, where it is the only line that says
          what this is at all. */}
      {remote.mark ? null : <Caption>{remote.type}</Caption>}

      {detail ? <Body>{detail}</Body> : null}

      {/* No test button here any more. jdp: "der pruefen button der ziele soll
          in ziele einrichten seite nicht auf die card, dann kann man direkt
          pruefen bevor man auf speichern tippt." It lives on the form, where it
          can run BEFORE a credential is kept - and two buttons running the same
          check, one against saved settings and one against typed ones, would be
          two things to explain with one of them always the wrong one to press. */}
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
  menuSlot: { marginStart: "auto" },
  actions: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
});
