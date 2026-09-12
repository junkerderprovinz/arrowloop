import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Glyph } from "./glyphs";
import { SCRIM, space, text, TOUCH } from "./theme";
import { useTheme } from "./ui";

/**
 * The three-dot menu on a card's top right.
 *
 * jdp: "rechts oben ein hamburgermenü mit bearbeiten und löschen."
 *
 * It exists because those two acts had nowhere good to be. Editing meant
 * opening the job and scrolling past everything it does to a button at the
 * bottom, and deleting was only reachable from inside that editor - so getting
 * rid of a job meant opening it first. Neither is something somebody does
 * often, which is exactly what a menu is for: present, out of the way, and not
 * competing with the two verbs that ARE used often.
 *
 * A Modal rather than a popover anchored to the dots. React Native has no
 * anchored menu without a native dependency, and a centred sheet is what every
 * other floating thing in this app already is - the picker, the colour picker,
 * the info bubble - so it is one shape rather than a second one.
 */
export function CardMenu({
  items,
}: {
  items: { label: string; glyph: string; danger?: boolean; onPress: () => void }[];
}) {
  const { p, radius } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        // The card underneath is pressable too, and a tap meant for the menu
        // that opened the job instead would be the worst kind of near miss.
        hitSlop={10}
        style={[styles.dots, { borderRadius: radius.pill }]}
      >
        {/* Three dots drawn from three Views, not a glyph. The app's icon
            set has no three-dot mark, and the rule against redrawing one is
            about somebody else's DRAWING - three circles are a primitive, not
            a design. Adding an icon to the generated set for this would mean
            adding a source nobody has. */}
        <View style={styles.dot} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.ground} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: p.surface, borderRadius: radius.card }]}
            onPress={() => {}}
          >
            {items.map((item) => (
              <Pressable
                key={item.label}
                android_ripple={{ color: p.hover }}
                onPress={() => {
                  // Closed BEFORE the act, so a confirmation dialog from a
                  // delete does not open behind this sheet.
                  setOpen(false);
                  item.onPress();
                }}
                style={[
                  styles.row,
                  { backgroundColor: p.surface2, borderRadius: radius.control },
                ]}
              >
                <Glyph name={item.glyph} color={item.danger ? p.failInk : p.text} size={18} />
                <Text
                  style={[styles.rowText, { color: item.danger ? p.failInk : p.text }]}
                  numberOfLines={1}
                >
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
  dots: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", gap: 3 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#8d8d8d" },
  ground: { flex: 1, backgroundColor: SCRIM, justifyContent: "center", padding: space.lg },
  sheet: { padding: space.md, gap: space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: TOUCH,
    paddingHorizontal: space.md,
  },
  rowText: { flex: 1, fontSize: text.body },
});
