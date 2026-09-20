import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { api, type Remote, type Usage } from "../api";
import { useT } from "../i18n";
import type { Nav, TargetsStack } from "../nav";
import { account, Room, unreachable, isAccount, useRoom, type Room as Space } from "../space";
import { space } from "../theme";
import { Badge, Body, Button, Caption, Card, CardHead, Empty, Fab, Floating, Page, useHue, useTheme } from "../ui";
import { CardMenu } from "../CardMenu";

/**
 * The configured targets, each with whether it answers and how full it is
 * where the service says.
 */
export function Targets() {
  const nav = useNavigation<Nav<TargetsStack>>();
  const { t } = useT();
  const [remotes, setRemotes] = useState<Remote[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      // The phone itself is not a connected target; see isAccount in space.tsx.
      setRemotes((await api.storage()).remotes.filter(isAccount));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const stop = nav.addListener("focus", load);
    return stop;
  }, [nav, load]);

  // Each card fills in its size as its own answer lands, so the slowest
  // service does not hold up the list.
  const room = useRoom(remotes);

  return (
    <Floating>
      <Page fab>
      {!remotes ? <Empty title={t("history.working")} detail={error || undefined} /> : null}
      {(remotes ?? []).map((remote, index) => (
        <TargetCard
          key={remote.name}
          remote={remote}
          room={room[remote.name]}
          index={index}
          onEdit={() => nav.navigate("TargetEdit", { name: remote.name })}
          onGone={load}
        />
      ))}

      {error ? <Caption>{error}</Caption> : null}
      </Page>
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
  room,
  index,
  onEdit,
  onGone,
}: {
  remote: Remote;
  room: Space;
  index: number;
  onEdit: () => void;
  onGone: () => void;
}) {
  const { t } = useT();
  const hue = useHue(index);

  /** A failed delete. */
  const [detail, setDetail] = useState("");

  const { who, where } = account(remote);

  const remove = () => {
    Alert.alert(t("confirm.deleteRemote"), t("confirm.deleteRemoteStakes", { name: remote.name }), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("confirm.delete"),
        // Not "destructive": GlimStone paints no delete red, dialogs included.
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
      <CardHead mark={remote.mark} title={remote.name}>
        {/* Unreachable belongs in the head, since it is about the target and
            not its size. */}
        {unreachable(room) ? <Badge label={t("targets.checkFailed")} tone="fail" /> : null}
        <View style={styles.menuSlot}>
          <CardMenu
            items={[
              { label: t("action.edit"), glyph: "IconEdit", onPress: onEdit },
              { label: t("action.delete"), glyph: "IconDelete", onPress: remove },
            ]}
          />
        </View>
      </CardHead>

      {/* Which account and where it points; see account() in space.tsx. */}
      {who ? <Caption>{who}</Caption> : null}
      {where ? <Caption>{where}</Caption> : null}

      <Room room={room} hue={hue} />
      {/* The protocol only for a target no provider mark describes. */}
      {remote.mark ? null : <Caption>{remote.type}</Caption>}

      {detail ? <Body>{detail}</Body> : null}
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
  menuSlot: { marginStart: "auto" },
  actions: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
});
