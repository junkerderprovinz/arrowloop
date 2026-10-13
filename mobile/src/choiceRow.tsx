import { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { Glyph } from "./glyphs";
import { contrastOn, space, text, TOUCH } from "./theme";
import { Choice, InfoBubble, Press, Row, useTheme } from "./ui";

type Option<T extends string> = { value: T; label: string; hint?: string };

/** The groove and segment sizes of Choice, which the ruler has to repeat to measure it. */
const WELL_PAD = 3;
const WELL_GAP = 2;
const SEGMENT_PAD = 6;
const BUBBLE = 18;

/**
 * A choice beside its name. The segments stand at the row's end where they
 * fit there; otherwise the row holds a dropdown, since a strip under its name
 * would break the card's edge of controls (GlimStone rule 35).
 */
export function ChoiceRow<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  hue,
  disabled,
}: {
  label: string;
  hint?: string;
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
  hue?: number;
  disabled?: boolean;
}) {
  const [room, setRoom] = useState(0);
  const [name, setName] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});

  // Choice shares its width evenly, so the widest segment sets every one.
  const measured = options.every((o) => widths[o.value] !== undefined);
  const widest = Math.max(0, ...options.map((o) => widths[o.value] ?? 0));
  const strip = options.length * widest + (options.length - 1) * WELL_GAP + 2 * WELL_PAD;
  const fits = room > 0 && name > 0 && measured && name + space.md + strip <= room;

  return (
    <View onLayout={(e) => setRoom(e.nativeEvent.layout.width)}>
      {/* Laid out at natural width far wider than the screen, so nothing in it
          wraps or shrinks before it is measured. */}
      <View style={styles.ruler} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={styles.rulerLine} onLayout={(e) => setName(e.nativeEvent.layout.width)}>
          <Text style={styles.name} numberOfLines={1}>
            {label}
          </Text>
          {hint ? <View style={styles.bubble} /> : null}
        </View>
        {options.map((o) => (
          <View
            key={o.value}
            style={styles.rulerSegment}
            onLayout={(e) => {
              const width = e.nativeEvent.layout.width;
              setWidths((was) => (was[o.value] === width ? was : { ...was, [o.value]: width }));
            }}
          >
            <Text style={styles.segmentText} numberOfLines={1}>
              {o.label}
            </Text>
            {o.hint ? <View style={styles.bubble} /> : null}
          </View>
        ))}
      </View>
      <Row
        label={label}
        hint={hint}
        control={
          fits ? (
            <Choice hue={hue} value={value} onChange={onChange} options={options} disabled={disabled} style={{ width: strip }} />
          ) : (
            <Dropdown label={label} hue={hue} value={value} onChange={onChange} options={options} disabled={disabled} />
          )
        }
      />
    </View>
  );
}

/**
 * The chosen option on a button that opens the list under it. The list is a
 * Modal, as the card menu is, because nothing else floats above a scrolling
 * page in React Native.
 */
function Dropdown<T extends string>({
  label,
  options,
  value,
  onChange,
  hue,
  disabled,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
  hue?: number;
  disabled?: boolean;
}) {
  const { p, corners, accent, hueAt } = useTheme();
  const screen = useWindowDimensions();
  const button = useRef<View>(null);
  const [at, setAt] = useState<{ top: number; right: number; width: number } | null>(null);
  const current = options.find((o) => o.value === value);
  const fill = (hue !== undefined ? hueAt(hue) : undefined) ?? accent;

  const open = () => {
    button.current?.measureInWindow((x, y, w, h) => {
      const height = options.length * (TOUCH + space.xs) + space.sm * 2;
      setAt({
        top: y + h + space.xs + height > screen.height ? Math.max(space.sm, y - height - space.xs) : y + h + space.xs,
        right: Math.max(space.sm, screen.width - (x + w)),
        width: w,
      });
    });
  };

  return (
    <>
      <View ref={button} collapsable={false} style={styles.slot}>
        <Press
          onPress={open}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${current?.label ?? ""}`}
          accessibilityState={{ disabled: !!disabled, expanded: at !== null }}
          android_ripple={{ color: p.hover }}
          style={[styles.button, { backgroundColor: p.surface2, ...corners.control }, disabled ? styles.dimmed : null]}
        >
          <Text style={[styles.buttonText, { color: p.text }]} numberOfLines={1}>
            {current?.label ?? ""}
          </Text>
          <Svg width={10} height={10} viewBox="0 0 10 10">
            <Path d="M2 4l3 3 3-3" stroke={p.textMuted} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </Press>
      </View>
      <Modal visible={at !== null} transparent animationType="fade" onRequestClose={() => setAt(null)}>
        <Pressable style={[styles.ground, { backgroundColor: p.scrim }]} onPress={() => setAt(null)}>
          <Pressable
            accessibilityRole="menu"
            accessibilityLabel={label}
            style={[
              styles.list,
              { backgroundColor: p.surface, ...corners.card, top: at?.top, right: at?.right, minWidth: Math.max(200, at?.width ?? 0) },
            ]}
            onPress={() => {}}
          >
            {options.map((o) => {
              const on = o.value === value;
              const ink = on ? contrastOn(fill) : p.text;
              return (
                <Press
                  key={o.value}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: on }}
                  android_ripple={{ color: p.hover }}
                  onPress={() => {
                    setAt(null);
                    if (!on) onChange(o.value);
                  }}
                  style={[styles.option, { backgroundColor: on ? fill : p.surface2, ...corners.control }]}
                >
                  <Text style={[styles.optionText, { color: ink }]} numberOfLines={1}>
                    {o.label}
                  </Text>
                  {o.hint ? <InfoBubble tip={o.hint} on={on ? ink : undefined} /> : null}
                  {on ? <Glyph name="IconCheck" color={ink} /> : null}
                </Press>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  ruler: { position: "absolute", left: 0, top: 0, width: 4000, opacity: 0, alignItems: "flex-start" },
  rulerLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rulerSegment: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: SEGMENT_PAD },
  name: { fontSize: text.body },
  segmentText: { fontSize: text.meta, fontWeight: "500" },
  bubble: { width: BUBBLE, height: BUBBLE },

  // Leaves the name room to be read beside a long option.
  slot: { flexShrink: 1, maxWidth: "60%" },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: TOUCH - space.sm,
    paddingHorizontal: space.md,
  },
  buttonText: { flexShrink: 1, fontSize: text.body },
  dimmed: { opacity: 0.4 },

  ground: { flex: 1 },
  list: { position: "absolute", maxWidth: 320, padding: space.sm, gap: space.xs, elevation: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH, paddingHorizontal: space.md },
  optionText: { flex: 1, fontSize: text.body },
});
