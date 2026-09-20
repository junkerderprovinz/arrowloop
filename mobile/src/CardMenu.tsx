import { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { Glyph } from "./glyphs";
import { SCRIM, space, text, TOUCH } from "./theme";
import { useTheme } from "./ui";

/**
 * One row of the menu. There is no danger style: every delete asks first, and
 * the question is the warning.
 */
export interface CardAction {
  label: string;
  glyph: string;
  onPress: () => void;
}

/**
 * The menu button on a card's top right. The menu opens next to the button,
 * since it belongs to one card; it is a Modal because React Native has no
 * other way to float above the list.
 */
export function CardMenu({ items }: { items: CardAction[] }) {
  const { p, radius } = useTheme();
  const screen = useWindowDimensions();
  const button = useRef<View>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);

  // The menu opens only once the button is measured, so it never paints at
  // the top left for a frame.
  const open = () => {
    button.current?.measureInWindow((x, y, w, h) => {
      const height = items.length * (TOUCH + space.xs) + space.sm * 2;
      setAt({
        // Above the button when there is no room below it.
        top: y + h + space.xs + height > screen.height ? Math.max(space.sm, y - height) : y + h + space.xs,
        right: Math.max(space.sm, screen.width - (x + w)),
      });
    });
  };

  return (
    <>
      <Pressable
        ref={button}
        onPress={open}
        accessibilityRole="button"
        // The card underneath is pressable too.
        hitSlop={6}
        android_ripple={{ color: p.hover }}
        style={[styles.button, { backgroundColor: p.surface2, borderRadius: radius.control }]}
      >
        {/* The icon set has no menu mark, so the three bars are plain Views. */}
        <View style={[styles.bar, { backgroundColor: p.text }]} />
        <View style={[styles.bar, { backgroundColor: p.text }]} />
        <View style={[styles.bar, { backgroundColor: p.text }]} />
      </Pressable>
      <Modal
        visible={at !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAt(null)}
      >
        <Pressable style={styles.ground} onPress={() => setAt(null)}>
          <Pressable
            style={[
              styles.sheet,
              { backgroundColor: p.surface, borderRadius: radius.card, top: at?.top, right: at?.right },
            ]}
            onPress={() => {}}
          >
            {items.map((item) => (
              <Pressable
                key={item.label}
                android_ripple={{ color: p.hover }}
                onPress={() => {
                  // Closed first, so a delete's confirmation does not open
                  // behind the sheet.
                  setAt(null);
                  item.onPress();
                }}
                style={[styles.row, { backgroundColor: p.surface2, borderRadius: radius.control }]}
              >
                <Glyph name={item.glyph} color={p.text} size={18} />
                <Text style={[styles.rowText, { color: p.text }]} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: TOUCH,
    height: TOUCH,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  bar: { width: 16, height: 2, borderRadius: 1 },

  // Fills the screen so a tap anywhere closes the menu.
  ground: { flex: 1, backgroundColor: SCRIM },
  sheet: {
    position: "absolute",
    minWidth: 200,
    maxWidth: 320,
    padding: space.sm,
    gap: space.xs,
    elevation: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: TOUCH,
    paddingHorizontal: space.md,
  },
  rowText: { flex: 1, fontSize: text.body },
});
