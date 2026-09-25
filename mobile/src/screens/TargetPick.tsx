import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, type Provider } from "../api";
import { useT } from "../i18n";
import type { Nav, TargetsStack } from "../nav";
import { space, text } from "../theme";
import { ProviderMark } from "../glyphs";
import { Caption, Empty, InfoBubble, Page, Title, useTheme } from "../ui";

/**
 * Picks the kind of storage for a new target, as tiles matching the web app's.
 * The engine lists only the providers compiled into this build. Only protocol
 * tiles carry a hint, since "SMB" or "WebDAV" does not say what it is.
 */
export function TargetPick() {
  const nav = useNavigation<Nav<TargetsStack>>();
  const { t } = useT();
  const { p, corners, scheme } = useTheme();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.storage().then(
      (s) => setProviders(s.providers),
      (e: Error) => setError(e.message),
    );
  }, []);

  if (!providers) return <Empty title={t("history.working")} detail={error || undefined} />;

  const clouds = providers.filter((x) => x.group === "cloud");
  const storage = providers.filter((x) => x.group === "storage");
  const protocols = providers.filter((x) => x.group === "protocol");

  const tile = (provider: Provider) => (
    // The (i) sits beside the tile rather than inside it, so tapping it does
    // not also open the form.
    <View key={provider.id} style={styles.cell}>
      <Pressable
        onPress={() => nav.navigate("TargetEdit", { provider: provider.id })}
        android_ripple={{ color: p.hover }}
        style={[
          styles.tile,
          { backgroundColor: p.surface2, ...corners.control },
        ]}
      >
        <View style={styles.markBox}>
          <ProviderMark name={provider.mark} width={MARK_W} height={MARK_H} color={p.textSub} scheme={scheme} />
        </View>
        {/* Two lines, since a name cut to one can read as another product. */}
        <Text style={[styles.name, { color: p.text }]} numberOfLines={2}>
          {provider.name}
        </Text>
      </Pressable>
      {provider.hint && provider.group === "protocol" ? (
        <View style={styles.bubble} pointerEvents="box-none">
          <InfoBubble tip={provider.hint} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Page>
      <Title>{t("targets.cloud")}</Title>
      <View style={styles.grid}>{clouds.map(tile)}</View>
      <Title>{t("targets.storage")}</Title>
      <View style={styles.grid}>{storage.map(tile)}</View>
      <Title>{t("targets.connections")}</Title>
      <View style={styles.grid}>{protocols.map(tile)}</View>
      {error ? <Caption>{error}</Caption> : null}
    </Page>
  );
}

// A wide box, since an SVG letterboxes inside it and many marks are wordmarks
// (Linkbox is 5.3:1).
const MARK_W = 96;
const MARK_H = 48;

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  // Two across with the grid gap between them, without measuring the window.
  cell: { width: "48%" },
  tile: {
    minHeight: 112,
    paddingHorizontal: space.sm,
    paddingVertical: space.md,
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  markBox: { height: MARK_H, width: MARK_W, alignItems: "center", justifyContent: "center" },
  name: { fontSize: text.body, fontWeight: "600", textAlign: "center" },
  bubble: { position: "absolute", top: 6, right: 6 },
});
