import { componentRows, numberLink, updateLine, whatsNewLabel, withApp, type ComponentRow, type ComponentText } from "@glimstone/core";
import { Linking, StyleSheet, Text, View } from "react-native";

import { GLIMSTONE_REPO, REPO } from "../../web/src/lib/donate";
import { GLIMSTONE_VERSION } from "./glimstone/version";
import { Glyph } from "./glyphs";
import { space, text } from "./theme";
import { Button, InfoBubble, Section, useTheme } from "./ui";

// GlimStone's Version and Components cards for the phone. The phone gets its
// new versions from its store, so the Version card checks nothing and offers
// no switch and no action, only the way to what this version brought.

const STORE = "F-Droid";

/** The first card of the Info tile: the app with its number, and where its updates come from. */
export function VersionSection({ words, version, hue }: { words: ComponentText; version: string; hue: number }) {
  const { p } = useTheme();
  const w = words.versionCard;
  const face = updateLine({ kind: "store", store: STORE }, w);
  const shown = numberLink({ name: "ArrowLoop", version, repoUrl: REPO });
  return (
    <Section title={w.title} hint={withApp(w.hint, "ArrowLoop")} hue={hue}>
      <View style={styles.head}>
        <Text style={[styles.app, { color: p.text }]}>ArrowLoop</Text>
        <Number shown={shown} unreleased={w.unreleased} big />
      </View>
      <View style={styles.foot}>
        <Text style={[styles.state, { color: p.textSub }]} accessibilityRole="text">
          {face.line}
        </Text>
        {/* The store's own page has the notes of every release; the running
            one's open here. */}
        <Button
          label={whatsNewLabel(w)}
          labelKey="version.whatsNew"
          mark={(ink) => (
            <View style={styles.markRow}>
              <View style={[styles.dot, { backgroundColor: p.textMuted }]} />
              <Glyph name="IconWhatsNew" color={ink} />
            </View>
          )}
          onPress={() => void Linking.openURL(`${REPO}/releases/tag/v${version.replace(/^v/, "")}`)}
        />
      </View>
    </Section>
  );
}

/** The second card: everything else that carries a number, what it is behind its (i). */
export function ComponentsSection({ words, rows, hue }: { words: ComponentText; rows: ComponentRow[]; hue: number }) {
  const { p } = useTheme();
  const w = words.componentsCard;
  // The design language's number is the one the phone's copied tokens follow.
  const design: ComponentRow = { name: "GlimStone", hint: w.design, version: GLIMSTONE_VERSION, repoUrl: GLIMSTONE_REPO, kind: "design" };
  return (
    <Section title={w.title} hint={withApp(w.hint, "ArrowLoop")} hue={hue}>
      <View style={styles.rows}>
        {componentRows([...rows, design]).map((row) => (
          <View key={row.name} style={styles.row}>
            <View style={styles.name}>
              <Text style={[styles.part, { color: p.text }]}>{row.name}</Text>
              {row.hint ? <InfoBubble tip={row.hint} /> : null}
            </View>
            <Number shown={numberLink(row)} unreleased={w.unreleased} />
          </View>
        ))}
      </View>
    </Section>
  );
}

/**
 * A version number as plain text in the text's colour, which opens the newest
 * release of its project. A phone has no pointer to hover with, so it never
 * takes the accent.
 */
function Number({
  shown,
  unreleased,
  big = false,
}: {
  shown: ReturnType<typeof numberLink>;
  unreleased: (version: string) => string;
  big?: boolean;
}) {
  const { p } = useTheme();
  const style = [big ? styles.bigNumber : styles.number, { color: big ? p.text : p.textSub }];
  if (!shown.href) return <Text style={style}>{shown.released ? shown.shown : unreleased(shown.shown)}</Text>;
  const href = shown.href;
  return (
    <Text accessibilityRole="link" style={style} onPress={() => void Linking.openURL(href)}>
      {shown.shown}
    </Text>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md },
  app: { fontSize: text.body, fontWeight: "600" },
  bigNumber: { fontSize: text.body, fontVariant: ["tabular-nums"] },
  number: { fontSize: 14, fontVariant: ["tabular-nums"] },
  // The state at the start and the button at the end; on a narrow card the
  // button drops under the words.
  foot: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.md, marginTop: space.md },
  state: { flexGrow: 1, flexShrink: 1, flexBasis: 128, fontSize: 14, lineHeight: 20 },
  markRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rows: { gap: space.md },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  name: { flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 1 },
  part: { fontSize: 14, lineHeight: 20 },
});
