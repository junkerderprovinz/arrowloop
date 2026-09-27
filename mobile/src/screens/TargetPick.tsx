import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, type Provider } from "../api";
import { useT } from "../i18n";
import type { Nav, TargetsStack } from "../nav";
import { providerHint, providerName } from "../../../web/src/lib/optionHint";
import { space, text } from "../theme";
import { brandTile, ProviderMark } from "../glyphs";
import { Caption, Empty, InfoBubble, Page, Title, useTheme } from "../ui";

/**
 * Picks the kind of storage for a new target, as tiles matching the web app's.
 * The engine lists only the providers compiled into this build. Only protocol
 * tiles carry a hint, since "SMB" or "WebDAV" does not say what it is.
 */
export function TargetPick() {
  const nav = useNavigation<Nav<TargetsStack>>();
  const { t } = useT();
  const { p, corners, scheme, accent, accentContrast } = useTheme();
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

  const tile = (provider: Provider) => {
    const hint = providerHint(provider.id, t);
    // A tile fills with its brand's colour while a finger is on it, as the
    // web's does under the pointer. A protocol wears one of the app's own
    // glyphs and takes the accent.
    const fill = brandTile(provider.mark) ?? { color: accent, ink: accentContrast };
    return (
      // The (i) sits beside the tile rather than inside it, so tapping it does
      // not also open the form.
      <View key={provider.id} style={styles.cell}>
        <Pressable
          onPress={() => nav.navigate("TargetEdit", { provider: provider.id })}
          style={({ pressed }) => [
            styles.tile,
            { backgroundColor: pressed ? fill.color : p.surface2, ...corners.control },
          ]}
        >
          {({ pressed }) => {
            const lit = pressed ? { ink: fill.ink, cut: fill.color } : undefined;
            return (
              <>
                <View style={styles.markBox}>
                  <ProviderMark
                    name={provider.mark}
                    width={MARK_W}
                    height={MARK_H}
                    color={lit ? lit.ink : p.textSub}
                    scheme={scheme}
                    lit={lit}
                  />
                </View>
                {/* Two lines, since a name cut to one can read as another product. */}
                <Text style={[styles.name, { color: lit ? lit.ink : p.text }]} numberOfLines={2}>
                  {providerName(provider, t)}
                </Text>
              </>
            );
          }}
        </Pressable>
        {hint && provider.group === "protocol" ? (
          <View style={styles.bubble} pointerEvents="box-none">
            <InfoBubble tip={hint} />
          </View>
        ) : null}
      </View>
    );
  };

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
