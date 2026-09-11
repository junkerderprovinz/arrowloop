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
 * Which kind of storage, by NAME rather than by protocol.
 *
 * The container's tile, tile for tile. jdp: "die Cloud Kacheln bitte genauso
 * machen wie in der container version." Which means the mark ABOVE the name and
 * both centred, rather than the mark beside it: a tile that puts them on one
 * line spends its width on the name and leaves the logo whatever is left, and
 * what is left was 20 pixels.
 *
 * The mark box is 96 by 48 and that is the whole point of the change. An svg
 * letterboxes inside its element, so a square box caps the LONGER side - and a
 * third of these marks are words rather than symbols. Linkbox is 5.3:1: in the
 * 20px square it had, it drew four pixels tall.
 *
 * No sub-text on a cloud tile. The name and the mark say it, and a line of
 * explanation under a brand somebody already recognises is noise on every tile
 * in order to help on none. The protocol tiles keep theirs, because "SMB" and
 * "WebDAV" genuinely do not say what they are - but in an (i) at the corner,
 * which is the house rule and also what keeps five tiles from standing taller
 * than the fifty-five around them.
 *
 * The list is whatever the ENGINE offers: `remotes.Providers()` filters by what
 * is actually compiled in, so a provider on screen is one this build can reach.
 */
export function TargetPick() {
  const nav = useNavigation<Nav<TargetsStack>>();
  const { t } = useT();
  const { p, radius, scheme } = useTheme();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.storage().then(
      (s) => setProviders(s.providers),
      (e: Error) => setError(e.message),
    );
  }, []);

  if (!providers) return <Empty title={t("history.working")} detail={error || undefined} />;

  const clouds = providers.filter((x) => x.group !== "protocol");
  const protocols = providers.filter((x) => x.group === "protocol");

  const tile = (provider: Provider) => (
    // The (i) is a SIBLING of the pressable tile rather than a child, the same
    // arrangement the web uses and for the same reason: nesting it would make a
    // tap on the (i) also fire the tile underneath and open the form for a
    // provider somebody was only reading about.
    <View key={provider.id} style={styles.cell}>
      <Pressable
        onPress={() => nav.navigate("TargetEdit", { provider: provider.id })}
        android_ripple={{ color: p.hover }}
        style={[
          styles.tile,
          // No border: a tile is one shade above the page, the way this language
          // separates every surface.
          { backgroundColor: p.surface2, borderRadius: radius.card },
        ]}
      >
        <View style={styles.markBox}>
          <ProviderMark name={provider.mark} width={MARK_W} height={MARK_H} color={p.textSub} scheme={scheme} />
        </View>
        {/* Two lines, and wrapping rather than an ellipsis. "OVHcloud Object
            Storage" truncated to one line is "OVHcloud Object S…", which reads
            as a different product; the name is the whole thing somebody is
            scanning for. */}
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
      <Title>{t("targets.connections")}</Title>
      <View style={styles.grid}>{protocols.map(tile)}</View>
      {error ? <Caption>{error}</Caption> : null}
    </Page>
  );
}

/** The mark's box: the web's 96 by 48, which is the number that lets a 5.3:1
 *  wordmark use the tile's width instead of a square's height. */
const MARK_W = 96;
const MARK_H = 48;

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  // Two across with the page's own gap between them, which is what `48%` buys
  // without having to measure the window.
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
