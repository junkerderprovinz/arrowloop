import { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { Glyph } from "./glyphs";
import { useT } from "./i18n";
import type { CardEntry } from "./jobMenu";
import { menuRoom } from "./layout";
import { endEdge, raised, space, text, TOUCH } from "./theme";
import { Button, Press, useTheme } from "./ui";

export type { CardAction, CardEntry } from "./jobMenu";

/**
 * The More button on a card's top right, or at the top of a job's screen, for
 * the rarer actions. It is an ordinary button that says "More" and follows the
 * label setting. The menu opens next to it, since it belongs to one card; it
 * is a Modal because React Native has no other way to float above the list.
 */
export function CardMenu({
  items,
  glyphOnly,
  note,
}: {
  items: CardEntry[];
  /** An ordinary button showing its glyph alone, where a row has no room for words. */
  glyphOnly?: boolean;
  /** A line above the rows, such as why they are disabled. */
  note?: string;
}) {
  const { t } = useT();
  const { p, corners } = useTheme();
  const screen = useWindowDimensions();
  const button = useRef<View>(null);
  const [at, setAt] = useState<{ top: number; edge: { left?: number; right?: number }; room: number } | null>(null);

  // A single action stands as a plain button, since a menu would only hide it.
  const only = items.length === 1 && items[0] !== "-" ? items[0] : undefined;
  const rows = items.filter((item) => item !== "-").length;
  const lines = items.length - rows;

  // The menu opens only once the button is measured, so it never paints at
  // the top left for a frame.
  const open = () => {
    button.current?.measureInWindow((x, y, w, h) => {
      const height =
        rows * (TOUCH + space.xs) + lines * (SEPARATOR + space.xs) + space.sm * 2 + (note ? NOTE_HEIGHT : 0);
      const edge = endEdge(x, w, screen.width);
      setAt({
        // Above the button when there is no room below it.
        top: y + h + space.xs + height > screen.height ? Math.max(space.sm, y - height) : y + h + space.xs,
        edge,
        room: menuRoom(screen.width, edge.left ?? edge.right ?? 0, space.lg),
      });
    });
  };

  if (only) {
    return (
      <Button
        label={only.label}
        glyph={only.glyph}
        glyphOnly={glyphOnly}
        wide={false}
        disabled={only.disabled}
        onPress={only.onPress}
      />
    );
  }

  return (
    <>
      {/* Measured through this view, since the button does not hand out its own. */}
      <View ref={button} collapsable={false}>
        <Button label={t("more.title")} glyph="IconMore" glyphOnly={glyphOnly} wide={false} onPress={open} />
      </View>
      <Modal
        visible={at !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAt(null)}
      >
        <Pressable style={[styles.ground, { backgroundColor: p.scrim }]} onPress={() => setAt(null)}>
          <Pressable
            style={[
              styles.sheet,
              { backgroundColor: p.surface, ...corners.card, top: at?.top, ...at?.edge, maxWidth: at?.room },
              raised(p),
            ]}
            onPress={() => {}}
          >
            {note ? <Text style={[styles.note, { color: p.textMuted }]}>{note}</Text> : null}
            {items.map((item, i) =>
              item === "-" ? (
                <View key={`-${i}`} style={[styles.separator, { backgroundColor: p.border }]} />
              ) : (
                <Press
                  key={item.label}
                  android_ripple={{ color: p.hover }}
                  disabled={item.disabled}
                  accessibilityState={{ disabled: !!item.disabled }}
                  onPress={() => {
                    // Closed first, so a delete's confirmation does not open
                    // behind the sheet.
                    setAt(null);
                    item.onPress();
                  }}
                  style={[
                    styles.row,
                    { backgroundColor: p.surface2, ...corners.control },
                    item.disabled ? styles.off : null,
                  ]}
                >
                  <Glyph name={item.glyph} color={p.text} size={18} />
                  <Text style={[styles.rowText, { color: p.text }]} numberOfLines={2}>
                    {item.label}
                  </Text>
                </Press>
              ),
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const SEPARATOR = StyleSheet.hairlineWidth;
// One line of caption text and the gap under it, for placing the sheet.
const NOTE_HEIGHT = 18 + space.xs;

const styles = StyleSheet.create({
  // Fills the screen so a tap anywhere closes the menu.
  ground: { flex: 1 },
  sheet: {
    position: "absolute",
    minWidth: 200,
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
  // Measured at its own width rather than flex: 1, whose zero basis lets the
  // sheet shrink to its minimum and cut the label.
  rowText: { flexGrow: 1, flexShrink: 1, fontSize: text.body },
  separator: { height: SEPARATOR, marginHorizontal: space.sm, opacity: 0.6 },
  note: { fontSize: text.subline, lineHeight: 18, paddingHorizontal: space.sm },
  off: { opacity: 0.5 },
});
