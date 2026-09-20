import { useMemo, useRef, useState } from "react";
import { Modal, PanResponder, Pressable, StyleSheet, TextInput, View } from "react-native";

import { hexToHsv, hsvToHex, normalizeHex } from "../../web/src/lib/colorMath";
import { useT } from "./i18n";
import { SCRIM, space, text } from "./theme";
import { Glyph } from "./glyphs";
import { Button, useTheme } from "./ui";

// A colour picker with a saturation/value pad, a hue rail and a hex field. The
// maths is web/src/lib/colorMath.ts, shared with the web picker. The pad is a
// grid of flat cells driven by one PanResponder, so it needs neither a gradient
// library nor a native gesture dependency.

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
  // The pan handlers are built once, so they read the colour through a ref
  // rather than a stale closure.
  const live = useRef(hsv);
  live.current = hsv;

  // Re-seeded from `initial` on every open: the Modal stays mounted, so the
  // state would otherwise keep the last colour. Keyed on `visible` because
  // `initial` changes during the drag.
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

  /** The pad's box in screen coordinates. */
  const box = useRef({ x: 0, y: 0, w: 1 });
  const padRef = useRef<View>(null);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Screen coordinates from gestureState, not nativeEvent.locationX,
        // which is relative to the grid cell under the finger.
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

  // Rebuilt only when the hue changes, so a drag moves just the marker instead
  // of redrawing 225 cells per frame.
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
      <Pressable style={styles.ground} onPress={onClose}>
        {/* Swallows presses so a drag inside does not close the picker. */}
        <Pressable
          style={[styles.panel, { backgroundColor: p.surface, borderRadius: radius.card }]}
          onPress={() => {}}
        >
          {/* Saturation left to right, value bottom to top. */}
          <View
            ref={padRef}
            style={[styles.pad, { borderRadius: radius.control }]}
            // measureInWindow, since the layout event's x/y are relative to the
            // parent and the gesture reports screen coordinates.
            onLayout={() => {
              padRef.current?.measureInWindow((x, y, w) => {
                box.current = { x, y, w };
              });
            }}
            {...responder.panHandlers}
          >
            {cells}
            {/* The marker's outer ring flips with the value beneath it, so it
                stays visible in both the white and the black corner. */}
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

          {/* The hue rail is tapped rather than dragged. */}
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
            {/* No hue, so the button wears the accent. "Close" rather than
                "Done", since the colour is already applied during the drag. */}
            <Button label={t("common.close")} labelKey="common.close" tone="accent" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * One colour disc. The selection is a ring inside the same outer box, so a
 * selected swatch does not grow and shift the row.
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
        {/* The first press selects the colour; a press on the selected one
            opens the picker. */}
        <View style={[styles.fill, { borderRadius: radius.pill, backgroundColor: hex }]} />
      </View>
    </Pressable>
  );
}

/**
 * The reset at the end of a row of swatches. It is always rendered and only
 * dimmed when there is nothing to undo, so the row never changes length. It
 * stays neutral, since an accent fill would make it look like one more colour.
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
    backgroundColor: SCRIM,
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
