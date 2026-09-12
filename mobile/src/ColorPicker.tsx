import { useMemo, useRef, useState } from "react";
import { Modal, PanResponder, Pressable, StyleSheet, TextInput, View } from "react-native";

import { hexToHsv, hsvToHex, normalizeHex } from "../../web/src/lib/colorMath";
import { useT } from "./i18n";
import { space, text } from "./theme";
import { Glyph } from "./glyphs";
import { Button, useTheme } from "./ui";

/**
 * A colour picker: a saturation/value pad, a hue rail and a hex field.
 *
 * It exists because the app could SHOW colours and not change them. Eight
 * accent presets were the whole of what a colour could be, and the rainbow
 * palette was drawn with `pointerEvents="none"` - eight circles that looked
 * like controls and answered nothing. The container has had a picker on both
 * rows for months.
 *
 * TRANSCRIBED FROM KNIGHTLOADER rather than written again, because that one was
 * paid for twice over in bugs that are invisible until somebody drags a finger
 * across it. Both are kept below as comments where they bit, because both are
 * the kind that come back.
 *
 * The maths is `web/src/lib/colorMath.ts`, the same file the browser's picker
 * reads, so a colour mixed here and the same colour mixed there are the same
 * six digits rather than nearly.
 *
 * Drawn from plain Views and one PanResponder. Two things deliberately not
 * used: a gradient library, because the pad is a grid of flat cells and that is
 * what a gradient looks like once it is quantised anyway; and
 * react-native-gesture-handler, because PanResponder is in React Native itself
 * and the alternative is a native dependency and a new prebuild for one drag.
 */

/** Cells across and down the saturation/value pad. */
const PAD = 15;
/** Steps along the hue rail. */
const HUES = 24;
const CLAMP = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export function ColorPicker({
  visible,
  initial,
  onPick,
  onClose,
}: {
  visible: boolean;
  initial: string;
  /** Called as the colour moves, so the page behind updates live. */
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const { p, radius } = useTheme();
  const { t } = useT();
  const start = hexToHsv(initial) ?? { h: 45, s: 1, v: 1 };
  const [hsv, setHsv] = useState(start);
  // Read by the pan handlers, which are built once: a handler closing over
  // `hsv` would hold the value from the render that created it, and the drag
  // would snap back to where it began on every frame.
  const live = useRef(hsv);
  live.current = hsv;

  /**
   * Re-seed from `initial` every time this opens.
   *
   * `useState(start)` runs ONCE, at mount - and this never unmounts, because a
   * Modal is toggled by its `visible` prop rather than by leaving the tree. So
   * the second time it opened it still held the colour from the first time, and
   * the first frame of the next drag wrote that old colour into whichever
   * swatch had just been pressed. From outside it read as the edit jumping to
   * another swatch while the first one reverted.
   *
   * Keyed on `visible` rather than on `initial`: `initial` changes as the drag
   * moves, because the caller applies the colour live, so re-seeding on it
   * would fight the gesture on every frame.
   */
  const wasOpen = useRef(false);
  if (visible && !wasOpen.current) {
    wasOpen.current = true;
    if (start.h !== hsv.h || start.s !== hsv.s || start.v !== hsv.v) {
      live.current = start;
      setHsv(start);
    }
  } else if (!visible && wasOpen.current) {
    wasOpen.current = false;
  }

  /** The pad's own box in SCREEN coordinates, measured rather than assumed. */
  const box = useRef({ x: 0, y: 0, w: 1 });
  const padRef = useRef<View>(null);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // moveX/moveY, NEVER nativeEvent.locationX.
        //
        // locationX is relative to the touch's TARGET, and the target is the
        // deepest view under the finger - which here is one of the pad's own
        // grid cells, not the pad. So x ran 0..19 instead of 0..288 and was
        // then divided by the pad's width: saturation never left the first few
        // per cent and value never left the top few, which reads as "I can only
        // pick very pale or very black". The pad held the responder the whole
        // time, which is what makes this one hard to see - the handler fires
        // correctly and reads the wrong number.
        //
        // gestureState's moveX/moveY are screen coordinates and belong to no
        // view at all, so they cannot pick up a child's origin.
        onPanResponderGrant: (_e, g) => move(g.x0, g.y0),
        onPanResponderMove: (_e, g) => move(g.moveX, g.moveY),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function move(pageX: number, pageY: number) {
    const b = box.current;
    const w = b.w || 1;
    const next = { h: live.current.h, s: CLAMP((pageX - b.x) / w), v: CLAMP(1 - (pageY - b.y) / w) };
    live.current = next;
    setHsv(next);
    onPick(hsvToHex(next.h, next.s, next.v));
  }

  const current = hsvToHex(hsv.h, hsv.s, hsv.v);

  // Rebuilt only when the HUE changes, never while dragging. Without this the
  // drag rebuilt 225 cells and ran 225 colour conversions every frame, which is
  // the difference between a smooth drag and one that stutters. Only the
  // marker actually moves during a drag, and a marker is one view.
  const cells = useMemo(
    () =>
      Array.from({ length: PAD }, (_, row) => (
        <View key={row} style={styles.padRow}>
          {Array.from({ length: PAD }, (_, col) => (
            <View
              key={col}
              style={{
                flex: 1,
                backgroundColor: hsvToHex(hsv.h, (col + 0.5) / PAD, 1 - (row + 0.5) / PAD),
              }}
            />
          ))}
        </View>
      )),
    [hsv.h],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* The ground closes it, which is what a popover does. The panel swallows
          the press so a drag inside never dismisses. */}
      <Pressable style={styles.ground} onPress={onClose}>
        <Pressable
          style={[styles.panel, { backgroundColor: p.surface, borderRadius: radius.card }]}
          onPress={() => {}}
        >
          {/* Saturation left to right, value bottom to top, at the hue chosen
              on the rail below. */}
          <View
            ref={padRef}
            style={[styles.pad, { borderRadius: radius.control }]}
            // measureInWindow, not the layout event's own x/y: those are
            // relative to the parent and the gesture reports screen
            // coordinates. Re-measured on every layout because the panel is
            // inside a Modal that lays out after it mounts.
            onLayout={() => {
              padRef.current?.measureInWindow((x, y, w) => {
                box.current = { x, y, w };
              });
            }}
            {...responder.panHandlers}
          >
            {cells}
            {/* Where you are. Two nested views rather than a border: this
                language separates surfaces by shade and never by a drawn line,
                and the swatch outside draws its ring the same way. The outer
                ink flips with the value under it, so the marker stays visible
                in a white corner and a black one alike. */}
            <View
              pointerEvents="none"
              style={[
                styles.dot,
                {
                  left: `${hsv.s * 100}%`,
                  top: `${(1 - hsv.v) * 100}%`,
                  backgroundColor: hsv.v > 0.6 ? "#161616" : "#ffffff",
                },
              ]}
            >
              <View style={[styles.dotFill, { backgroundColor: current }]} />
            </View>
          </View>

          {/* The hue rail, tapped rather than dragged: 24 wide targets in a row,
              and a tap lands on the one you meant. */}
          <View style={[styles.rail, { borderRadius: radius.control }]}>
            {Array.from({ length: HUES }, (_, i) => {
              const h = (i * 360) / HUES;
              return (
                <Pressable
                  key={i}
                  accessibilityLabel={`${Math.round(h)}°`}
                  style={{ flex: 1, backgroundColor: hsvToHex(h, 1, 1) }}
                  onPress={() => {
                    const next = { ...live.current, h };
                    live.current = next;
                    setHsv(next);
                    onPick(hsvToHex(next.h, next.s, next.v));
                  }}
                />
              );
            })}
          </View>

          <View style={styles.foot}>
            <View
              style={[styles.preview, { backgroundColor: current, borderRadius: radius.pill }]}
            />
            <TextInput
              style={[
                styles.hex,
                { backgroundColor: p.surface2, color: p.text, borderRadius: radius.control },
              ]}
              value={current.toUpperCase()}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              accessibilityLabel="Hex"
              onChangeText={(typed) => {
                const n = normalizeHex(typed);
                if (!n) return;
                const parsed = hexToHsv(n);
                if (!parsed) return;
                live.current = parsed;
                setHsv(parsed);
                onPick(n);
              }}
            />
          </View>

          <View style={styles.actions}>
            {/* NO hue, and that is the one deliberate exception on this screen:
                without one the button resolves to the accent, which is exactly
                what it should wear. It closes a dialog whose whole subject is a
                colour, and giving it a palette POSITION would paint it in a
                colour that has nothing to do with the one being mixed. */}
            {/* "Close", not "Done", and that is not a shrug: the colour is
                applied on every frame of the drag, so there is nothing here to
                confirm. A button labelled Done over a change that already
                happened invites somebody to look for a Cancel that does not
                exist either. */}
            <Button label={t("common.close")} labelKey="common.close" tone="accent" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * One colour disc, and the selection is a RING rather than an outline.
 *
 * An outline is drawn outside the box, so a selected swatch grows and the row
 * jumps every time somebody picks a different colour. Here every swatch keeps
 * the same outer box in both states and only the ring's colour moves, which is
 * what makes a row of eight read as one control. The same construction the
 * container uses, and the same one this app's own `Swatch` already had.
 */
export function EditableSwatch({
  hex,
  label,
  selected,
  onPress,
}: {
  hex: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { p, radius } = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.ring,
        { borderRadius: radius.pill, backgroundColor: selected ? p.text : "transparent" },
      ]}
    >
      <View
        style={[
          styles.gap,
          { borderRadius: radius.pill, backgroundColor: selected ? p.surface : "transparent" },
        ]}
      >
        {/* No pencil on the disc, and that is a decision rather than an
            omission: a second mark on a 26px circle is a smudge, and the
            colour is the thing the circle is for.

            WHAT A PRESS MEANS is two things in order, which is jdp's call:
            "Farbfelder sollen erst mit einem zweiten klick auf die fläche
            editierbar sein bzw soll der fabpicker erst dann kommen." The first
            press picks the colour; a second press on the one already picked
            opens the picker. One press used to do both, which meant a full
            picker appeared every time somebody only wanted to choose a colour
            from the eight in front of them - the common act interrupted by the
            rare one. The ring this component already draws around the chosen
            swatch is what says which one a second press would edit. */}
        <View style={[styles.fill, { borderRadius: radius.pill, backgroundColor: hex }]} />
      </View>
    </Pressable>
  );
}

/**
 * The reset at the end of a row of colour swatches.
 *
 * ALWAYS rendered, dimmed when there is nothing to undo, never conditionally
 * unmounted - and this is the one greyed control this language allows. It is
 * REPORTING rather than refusing: "the accent is already the default" is an
 * answer about the thing the control acts on, not about a decision made
 * somewhere else on the page. A control that appears only once it has work to
 * do is a control nobody knows about until they have already made the mess, and
 * a row whose length changes as you use it is a row that moves under the thumb.
 *
 * Deliberately NOT in the colour engine, which is the exception the container
 * makes too: it sits inside the very row of colours it throws away, so an
 * accent or rainbow fill would make it read as one more colour to pick - when
 * pressing it discards the picked colour instead.
 */
export function ResetMark({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { p, radius } = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={[
        styles.reset,
        {
          backgroundColor: p.surface2,
          borderRadius: radius.control,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Glyph name="IconReset" color={p.textSub} size={14} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  reset: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  ground: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  panel: { width: "100%", maxWidth: 340, padding: space.lg, gap: space.md },
  pad: { width: "100%", aspectRatio: 1, overflow: "hidden" },
  padRow: { flex: 1, flexDirection: "row" },
  dot: {
    position: "absolute",
    width: 16,
    height: 16,
    marginLeft: -8,
    marginTop: -8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  dotFill: { width: 11, height: 11, borderRadius: 5.5 },
  rail: { flexDirection: "row", height: 22, overflow: "hidden" },
  foot: { flexDirection: "row", alignItems: "center", gap: space.sm },
  preview: { width: 32, height: 32 },
  hex: {
    flex: 1,
    height: 40,
    paddingHorizontal: space.md,
    fontSize: text.dense,
    fontVariant: ["tabular-nums"],
  },
  actions: { flexDirection: "row" },

  ring: { flex: 1, maxWidth: 32, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  gap: { width: "88%", height: "88%", alignItems: "center", justifyContent: "center" },
  fill: { width: "86%", height: "86%", alignItems: "center", justifyContent: "center" },
});
