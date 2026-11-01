import { StyleSheet, Text, View } from "react-native";
import { contrastOn, space, text } from "./theme";
import { Press, useTheme } from "./ui";

export interface Tile<T extends string> {
  id: T;
  label: string;
  count: number;
  /** The number's ink where its colour says something, such as a severity's. */
  tone?: string;
}

/**
 * The tiles over a list as a row of chips, the form they take on a phone. A
 * tap picks the rows a chip stands for and a second tap shows them all again;
 * the rest of the screen stays.
 */
export function Tiles<T extends string>({
  label,
  tiles,
  picked,
  onPick,
}: {
  label: string;
  tiles: Tile<T>[];
  picked: T | null;
  onPick: (id: T) => void;
}) {
  const { p, corners, accent } = useTheme();
  return (
    <View style={styles.tiles} accessibilityLabel={label}>
      {tiles.map((tile) => {
        const on = picked === tile.id;
        const ink = on ? contrastOn(accent) : undefined;
        return (
          <Press
            key={tile.id}
            onPress={() => onPick(tile.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            android_ripple={{ color: p.hover }}
            style={[styles.tile, { backgroundColor: on ? accent : p.surface2, ...corners.pill }]}
          >
            <Text style={[styles.label, { color: ink ?? p.text }]} numberOfLines={1}>
              {tile.label}
            </Text>
            <Text style={[styles.number, { color: ink ?? tile.tone ?? p.text }]}>{tile.count}</Text>
          </Press>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: space.sm,
  },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 36,
    paddingHorizontal: space.md,
  },
  number: {
    fontSize: text.body,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontSize: text.body,
  },
});
