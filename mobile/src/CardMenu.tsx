import { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { Glyph } from "./glyphs";
import { SCRIM, space, text, TOUCH } from "./theme";
import { useTheme } from "./ui";

/**
 * One row of the menu.
 *
 * No `danger` flag. jdp: "hoer bitte auf die loeschen buttons immer rot
 * einzufaerben. die werden immer ganz normal eingefaerbt." Every delete in this
 * app asks before it acts, and a colour that shouts on every one of them stops
 * meaning anything by the third time somebody sees it. The question is the
 * warning; the row is just a row.
 */
export interface CardAction {
  label: string;
  glyph: string;
  onPress: () => void;
}

/**
 * The menu on a card's top right, and the button that opens it.
 *
 * jdp, in order: "rechts oben ein hamburgermenue mit bearbeiten und loeschen",
 * then "das hamburgermenue soll ein button sein mit hintergrund, auch der Punkt
 * Auftrag oeffnen soll im menue enthalten sein. Das fenster soll nicht in der
 * mitte des fensters erscheinen sondern direkt am hamburger menue. Der glyph
 * soll drei striche sein anstatt drei punkte."
 *
 * All four corrections point the same way, and the first version had it wrong in
 * the same way each time: it was drawn as a hint rather than as a control.
 *
 *  - IT IS A BUTTON, so it has a ground like every other button in the app.
 *    Three marks floating on a card read as decoration, and somebody has to
 *    guess that they can be pressed.
 *  - IT OPENS WHERE IT IS. A sheet in the middle of the screen is a dialog, and
 *    a dialog is for something that needs answering. This is a menu belonging to
 *    ONE card, and appearing next to that card is how it says which one.
 *  - THREE LINES, not three dots. Both are primitives rather than somebody's
 *    drawing, so neither needs the icon set; jdp asked for the one that reads as
 *    a menu everywhere else.
 *
 * Still a Modal underneath, because React Native has nothing that floats above
 * the list without one. What changed is where its contents sit: measured against
 * the button and placed there, rather than centred.
 */
export function CardMenu({ items }: { items: CardAction[] }) {
  const { p, radius } = useTheme();
  const screen = useWindowDimensions();
  const button = useRef<View>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);

  /**
   * Measure first, open second.
   *
   * `measureInWindow` is asynchronous, so opening the modal and measuring in
   * parallel would paint the sheet at the top left for a frame and then jump.
   * The measurement IS the open: no position, no menu.
   */
  const open = () => {
    button.current?.measureInWindow((x, y, w, h) => {
      const height = items.length * (TOUCH + space.xs) + space.sm * 2;
      setAt({
        // Below the button, unless there is no room below - then above it, so a
        // card near the bottom of a list does not open its menu off-screen.
        top: y + h + space.xs + height > screen.height ? Math.max(space.sm, y - height) : y + h + space.xs,
        // Anchored by its RIGHT edge to the button's right edge, which is what
        // keeps it under the button rather than running off the screen.
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
        // The card underneath is pressable too, and a tap meant for the menu
        // that opened the job instead would be the worst kind of near miss.
        hitSlop={6}
        android_ripple={{ color: p.hover }}
        style={[styles.button, { backgroundColor: p.surface2, borderRadius: radius.control }]}
      >
        {/* Three bars, drawn from three Views. The app's icon set has no menu
            mark, and the rule against redrawing one is about somebody else's
            DRAWING - three rectangles are a primitive, not a design. Adding one
            to the generated set would mean adding a source nobody has. */}
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
                  // Closed BEFORE the act, so a confirmation dialog from a
                  // delete does not open behind this sheet.
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
  // A real button: its own ground, its own touch target, the bars centred in it.
  button: {
    width: TOUCH,
    height: TOUCH,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  bar: { width: 16, height: 2, borderRadius: 1 },

  // The ground fills the screen so a tap anywhere closes the menu, and the
  // sheet is placed on it by the measurement rather than by a layout rule.
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
