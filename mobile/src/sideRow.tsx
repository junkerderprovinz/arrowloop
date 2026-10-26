import { StyleSheet, View } from "react-native";

import type { Remote } from "./api";
import { Glyph, ProviderMark } from "./glyphs";
import { markForSide } from "./jobMark";
import { space } from "./theme";
import { Body, useTheme } from "./ui";

/**
 * One side of a job, its path behind a mark: the phone glyph for a path on
 * this device, the provider's mark for a target, and an empty slot when the
 * product is unknown.
 */
export function SideRow({ path, mark }: { path: string; mark?: string }) {
  const { p, scheme } = useTheme();
  return (
    <View style={styles.side}>
      {mark === DEVICE ? (
        <Glyph name="IconPhone" color={p.textSub} size={16} />
      ) : mark ? (
        // In one ink, like the device glyph it stands beside.
        <ProviderMark name={mark} width={18} height={18} color={p.textSub} scheme={scheme} mono />
      ) : (
        // Keeps the two paths aligned.
        <View style={styles.blank} />
      )}
      <Body>{path}</Body>
    </View>
  );
}

/** The mark for a folder on this phone. */
export const DEVICE = "__device__";

/** The mark SideRow draws for a side: the phone, a provider, or none. */
export function sideMark(side: string, remotes: Remote[]): string | undefined {
  if (side.indexOf(":") < 2) return side ? DEVICE : undefined;
  return markForSide(side, remotes);
}

const styles = StyleSheet.create({
  side: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  blank: { width: 18 },
});
