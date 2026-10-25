import { NavigationContext } from "@react-navigation/native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
  type DimensionValue,
  type FlatListProps,
  type PressableProps,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { Glyph, glyphNameForKey, GLYPH, ProviderMark } from "./glyphs";
import {
  contrastOn,
  inkFor,
  palettes,
  RAINBOW,
  cornersFor,
  softOn,
  space,
  text,
  TOUCH,
  type Palette,
  type Corners,
  type Radii,
} from "./theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "./i18n";
import { useAppearance, type BarLabelMode, type LabelMode } from "./settings";
import { useWalkedPalette } from "./disco";
import { springOf, useConfirm, useMotion, useSystemReduced, type MotionIntensity } from "./motion";
import { arrivalDelay, arrivalSide, edgeReach } from "./motionNative";

// GlimStone's controls for React Native, with the design language's shapes
// and sizes: a notch 22 tall overlapping its card by half, a well whose chosen
// segment is the only filled one, a 36 by 20 switch with a 16 knob. Surfaces
// are separated by shade, never by borders, and every radius is read from the
// shape setting at render time.

export interface Theme {
  p: Palette;
  corners: Record<keyof Radii, Corners>;
  labels: LabelMode;
  /** The bottom bar's label mode, resolved from its own setting. */
  barLabels: LabelMode;
  rainbow: boolean;
  scheme: "dark" | "light";
  accent: string;
  accentContrast: string;
  /** The accent darkened enough to read as text on this scheme. */
  accentInk: string;
  /** The colour for one position in a set, or undefined with the mode off. */
  hueAt: (index: number) => string | undefined;
}

export function useTheme(): Theme {
  const system = useColorScheme() === "light" ? "light" : "dark";
  const a = useAppearance();
  const walked = useWalkedPalette();
  const scheme = a.theme === "system" ? system : a.theme;
  const base = palettes[scheme];
  return {
    scheme,
    p: base,
    corners: cornersFor(a.shape),
    // A stored `reactive` resolves to symbols; see settings.ts.
    labels: a.labels === "reactive" ? "glyph" : a.labels,
    barLabels: barMode(a.barLabels, a.labels),
    rainbow: a.rainbow,
    accent: a.accent,
    accentContrast: contrastOn(a.accent),
    accentInk: inkFor(a.accent, scheme),
    hueAt: (index: number) => {
      if (!a.rainbow) return undefined;
      // Disco's colours already carry the rotation.
      if (walked) return walked[((Math.trunc(index) % walked.length) + walked.length) % walked.length];
      const set = a.palette.length ? a.palette : RAINBOW;
      // Zero unless rotation is on, so switching it off restores every colour.
      const off = a.rainbowRotate ? a.rainbowSeed : 0;
      const n = ((Math.trunc(index) % set.length) + set.length) % set.length;
      return set[(n + off) % set.length];
    },
  };
}

export function usePalette(): Palette {
  return useTheme().p;
}

/**
 * Resolves the bar's label mode. Two stored values the picker does not offer
 * are mapped: `same` follows the global setting and `reactive` becomes symbols.
 */
function barMode(bar: BarLabelMode, everywhere: LabelMode): LabelMode {
  const mode = bar === "same" ? everywhere : bar;
  return mode === "reactive" ? "glyph" : mode;
}

/** Returns the colour for a position in a set, or the accent without the rainbow. */
export function useHue(index: number): string {
  const { accent, hueAt } = useTheme();
  return hueAt(index) ?? accent;
}

/**
 * The cards of one page or list arriving: each takes the next place in line,
 * and the whole line plays again when the tab comes back into view. A card
 * that mounts after the list was scrolled came in by scrolling, and appears
 * without flying in.
 */
type Line = { take: () => number; round: number; scrolled: { current: boolean } };
const Arrival = createContext<Line | null>(null);

/** The moving style for one card on a page, or nothing outside a page. */
function useArrival() {
  const line = useContext(Arrival);
  const { ms } = useMotion();
  const place = useRef<number | null>(null);
  const late = useRef(false);
  if (line && place.current === null) {
    place.current = line.take();
    late.current = line.scrolled.current;
  }
  const v = useRef(new Animated.Value(line && ms.travel > 0 && !late.current ? 0 : 1)).current;
  const round = line?.round;
  const born = useRef(round);

  useEffect(() => {
    if (round === undefined || ms.travel === 0 || (late.current && round === born.current)) {
      v.setValue(1);
      return;
    }
    v.setValue(0);
    // Waiting for the tab's first focus, which follows the mount at once.
    if (round < 0) return;
    const run = Animated.spring(v, {
      toValue: 1,
      delay: arrivalDelay(place.current ?? 0, ms),
      useNativeDriver: true,
      ...springOf(ms.bounce),
    });
    run.start();
    return () => run.stop();
  }, [round, ms, v]);

  if (!line) return null;
  // Every other card comes from the other side. Translation only: a card
  // holds a meter and buttons that move on their own.
  const side = arrivalSide(place.current ?? 0);
  return {
    opacity: v.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
    transform: [
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [ms.travel, 0] }) },
      { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [side * ms.sway, 0] }) },
    ],
  };
}

/**
 * How far a control dims while a finger holds it. A touch screen has no hover,
 * so this is how a press is answered at every motion level.
 */
export const HELD = 0.6;

/**
 * A scale that gives way under a finger and springs back, and an opacity that
 * dims while the finger stays. The dim is set rather than animated, since
 * opacity never rides a spring.
 */
export function usePress() {
  const { ms } = useMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const dim = useRef(new Animated.Value(1)).current;
  const to = (value: number) =>
    Animated.spring(scale, { toValue: value, useNativeDriver: true, ...springOf(ms.bounce) }).start();
  return {
    scale,
    dim,
    onPressIn: () => {
      dim.setValue(HELD);
      if (ms.press < 1) to(ms.press);
    },
    onPressOut: () => {
      dim.setValue(1);
      to(1);
    },
  };
}

/**
 * A Pressable that dims while it is held. With no `onLongPress` anywhere, a
 * long press still ends in `onPress`: it counts as a slow tap.
 */
export function Press({ style, ...props }: Omit<PressableProps, "style"> & { style?: StyleProp<ViewStyle> }) {
  return <Pressable {...props} style={({ pressed }) => [style, pressed && !props.disabled ? styles.held : null]} />;
}

/**
 * What a scrolling page or list shares: the arrival line for its cards and a
 * spring at either end, where the content runs on past the edge and swings
 * back. Android's own overscroll glow stays at the levels without one.
 */
function useScrollMotion() {
  const { ms } = useMotion();
  const nav = useContext(NavigationContext);
  // Outside a navigator nothing will report focus, so the cards go at once;
  // a page that mounts after its tab was focused goes at once as well.
  const [round, setRound] = useState(!nav || nav.isFocused() ? 0 : -1);
  const next = useRef(0);
  const scrolled = useRef(false);
  // A tab stays mounted when it is left, so its cards arrive again on return.
  useEffect(() => nav?.addListener("focus", () => setRound((r) => r + 1)), [nav]);
  const line = useMemo<Line>(() => ({ take: () => next.current++, round, scrolled }), [round]);

  const shift = useRef(new Animated.Value(0)).current;
  const resting = useRef<"top" | "bottom" | null>("top");
  const kick = (edge: "top" | "bottom", speed: number) => {
    Animated.sequence([
      Animated.timing(shift, { toValue: edgeReach(edge, speed, ms), duration: 90, useNativeDriver: true }),
      Animated.spring(shift, { toValue: 0, useNativeDriver: true, ...springOf(ms.bounce) }),
    ]).start();
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement, velocity } = e.nativeEvent;
    if (contentOffset.y > 0) scrolled.current = true;
    const at =
      contentOffset.y <= 0
        ? "top"
        : contentOffset.y + layoutMeasurement.height >= contentSize.height - 1
          ? "bottom"
          : null;
    if (at && at !== resting.current && ms.edge > 0) kick(at, velocity?.y ?? 0);
    resting.current = at;
  };

  return {
    line,
    style: { flex: 1, transform: [{ translateY: shift }] },
    scroll: {
      onScroll,
      scrollEventThrottle: 16,
      overScrollMode: ms.edge > 0 ? ("never" as const) : ("auto" as const),
    },
  };
}

/** A FlatList whose cards arrive like a page's and which springs at either end. */
export function MovingList<T>(props: FlatListProps<T>) {
  const motion = useScrollMotion();
  const { onScroll } = props;
  return (
    <Arrival.Provider value={motion.line}>
      <Animated.View style={motion.style}>
        <FlatList
          {...props}
          {...motion.scroll}
          onScroll={(e) => {
            motion.scroll.onScroll(e);
            onScroll?.(e);
          }}
        />
      </Animated.View>
    </Arrival.Provider>
  );
}

/** A row that is not a card, arriving with the cards around it. */
export function Arrive({ children }: { children: ReactNode }) {
  const arrival = useArrival();
  return <Animated.View style={arrival}>{children}</Animated.View>;
}

export function Screen({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <View style={[styles.screen, { backgroundColor: p.background }]}>{children}</View>;
}

/** A plain surface one shade above the page, without border or title. */
export function Card({
  children,
  onPress,
  style,
  hue,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  hue?: string;
}) {
  const { p, corners } = useTheme();
  const arrival = useArrival();
  const press = usePress();
  const body = (
    <View style={[styles.card, { backgroundColor: p.surface, ...corners.card }, style]}>
      {children}
    </View>
  );
  if (!onPress) return <Animated.View style={arrival}>{body}</Animated.View>;
  return (
    <Animated.View
      style={[
        arrival,
        {
          opacity: arrival ? Animated.multiply(arrival.opacity, press.dim) : press.dim,
          transform: [...(arrival?.transform ?? []), { scale: press.scale }],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        android_ripple={{ color: p.hover }}
        style={corners.card}
      >
        {body}
      </Pressable>
    </Animated.View>
  );
}

/**
 * A card whose title is a notch: a filled badge sitting half over the top
 * edge, with the card's (i) beside the title.
 */
export function Section({
  title,
  hint,
  hue,
  onTitlePress,
  children,
}: {
  title: string;
  hint?: string;
  /** This card's position among the page's cards, 0-based. */
  hue?: number;
  /** A tap on the title, which looks the same whether or not this is set. */
  onTitlePress?: () => void;
  children: ReactNode;
}) {
  const { p, corners, accent, accentContrast, hueAt } = useTheme();
  const fill = (hue !== undefined ? hueAt(hue) : undefined) ?? accent;
  const ink = contrastOn(fill) || accentContrast;
  const arrival = useArrival();
  return (
    <Animated.View style={[styles.notchWrap, arrival]}>
      <View style={[styles.notchCard, { backgroundColor: p.surface, ...corners.card }]}>
        {children}
      </View>
      <View style={[styles.notch, { backgroundColor: fill, ...corners.pill }]}>
        <Text
          style={[styles.notchText, { color: ink }]}
          numberOfLines={1}
          onPress={onTitlePress}
          // No pressed state, so a listening title does not give itself away.
          disabled={!onTitlePress}
        >
          {title}
        </Text>
        {hint ? <InfoBubble tip={hint} on={ink} /> : null}
      </View>
    </Animated.View>
  );
}

/**
 * The top of a card that a virtualised list draws piece by piece: the notch
 * and the card's upper corners. The rows go in ListPiece and the card closes
 * with ListEnd, so a long list still reads as one card.
 */
export function ListTop({ title, hue }: { title: string; hue?: number }) {
  const { p, corners, accent, hueAt } = useTheme();
  const fill = (hue !== undefined ? hueAt(hue) : undefined) ?? accent;
  const c = corners.card;
  return (
    <View style={styles.notchWrap}>
      <View
        style={[
          styles.listTop,
          {
            backgroundColor: p.surface,
            borderTopLeftRadius: c.borderTopLeftRadius ?? c.borderRadius,
            borderTopRightRadius: c.borderTopRightRadius ?? c.borderRadius,
          },
        ]}
      />
      <View style={[styles.notch, { backgroundColor: fill, ...corners.pill }]}>
        <Text style={[styles.notchText, { color: contrastOn(fill) }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </View>
  );
}

/** One stretch of a ListTop's card, at the card's ground and side padding. */
export function ListPiece({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <View style={[styles.listPiece, { backgroundColor: p.surface }]}>{children}</View>;
}

/** The lower end of a ListTop's card. */
export function ListEnd() {
  const { p, corners } = useTheme();
  const c = corners.card;
  return (
    <View
      style={[
        styles.listEnd,
        {
          backgroundColor: p.surface,
          borderBottomLeftRadius: c.borderBottomLeftRadius ?? c.borderRadius,
          borderBottomRightRadius: c.borderBottomRightRadius ?? c.borderRadius,
        },
      ]}
    />
  );
}

/**
 * A window that rises from the bottom edge, for what a row used to fold out:
 * its title as a badge, the content scrolling between, and Close in the
 * bottom row, in reach of the thumb.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { p, corners, accent } = useTheme();
  const { t } = useT();
  const { ms } = useMotion();
  const inset = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType={ms.fade ? "fade" : "none"} onRequestClose={onClose}>
      <View style={[styles.sheetGround, { paddingBottom: Math.max(inset.bottom, space.sm) }]}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: p.surface, ...corners.card }]}>
          <View style={styles.sheetHead}>
            <View style={[styles.sheetTitle, { backgroundColor: accent, ...corners.pill }]}>
              <Text style={[styles.notchText, { color: contrastOn(accent) }]} numberOfLines={2}>
                {title}
              </Text>
            </View>
          </View>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody}>
            {children}
          </ScrollView>
          <View style={styles.sheetFoot}>
            <Button label={t("common.close")} labelKey="common.close" wide={false} onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** A row inside a card: label left, control flush right. */
export function Row({
  label,
  hint,
  control,
  onPress,
}: {
  label: string;
  hint?: string;
  control?: ReactNode;
  onPress?: () => void;
}) {
  const { p } = useTheme();
  const body = (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[styles.body, { color: p.text, flexShrink: 1 }]}>{label}</Text>
        {hint ? <InfoBubble tip={hint} /> : null}
      </View>
      {control}
    </View>
  );
  return onPress ? (
    <Press onPress={onPress} accessibilityRole="button">
      {body}
    </Press>
  ) : (
    body
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <Text style={[styles.heading, { color: p.text }]}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <Text style={[styles.title, { color: p.text }]}>{children}</Text>;
}

/**
 * The head of a job or target card: the provider's logo, the name at heading
 * size, then whatever else belongs on the line.
 */
export function CardHead({
  mark,
  title,
  children,
}: {
  /** The provider's logo, where the target names one. */
  mark?: string;
  title: string;
  /** Badges, a menu, anything that belongs on the same line. */
  children?: ReactNode;
}) {
  const { p, scheme } = useTheme();
  return (
    <View style={styles.cardHead}>
      {mark ? (
        <View style={styles.cardHeadMark}>
          <ProviderMark name={mark} width={32} height={32} color={p.textSub} scheme={scheme} />
        </View>
      ) : null}
      <Text style={[styles.cardHeadTitle, { color: p.text }]} numberOfLines={1}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Body({
  children,
  muted,
  lines,
  onTextLayout,
}: {
  children: ReactNode;
  muted?: boolean;
  /** The most lines shown, the rest cut with an ellipsis. */
  lines?: number;
  onTextLayout?: TextProps["onTextLayout"];
}) {
  const { p } = useTheme();
  return (
    <Text
      style={[styles.body, { color: muted ? p.textMuted : p.textSub }]}
      numberOfLines={lines}
      onTextLayout={onTextLayout}
    >
      {children}
    </Text>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <Text style={[styles.caption, { color: p.textMuted }]}>{children}</Text>;
}

/**
 * A label and a value on one line, for reading rather than changing, unlike
 * Row. The value is the brighter ink and wraps instead of squeezing the label.
 */
export function Pair({ label, value }: { label: string; value: ReactNode }) {
  const { p } = useTheme();
  return (
    <View style={styles.pair}>
      <Text style={[styles.pairLabel, { color: p.textMuted }]}>{label}</Text>
      <Text style={[styles.pairValue, { color: p.text }]}>{value}</Text>
    </View>
  );
}

/** A small uppercase label naming an axis above its control. */
export function AxisLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  const { p } = useTheme();
  if (!hint) return <Text style={[styles.axis, { color: p.textSub }]}>{children}</Text>;
  return (
    <View style={styles.axisRow}>
      <Text style={[styles.axis, { color: p.textSub }]}>{children}</Text>
      <InfoBubble tip={hint} />
    </View>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <Text style={[styles.mono, { color: p.textSub }]}>{children}</Text>;
}

export type Tone = "accent" | "neutral" | "ok" | "fail" | "warn";

/**
 * A status word on a faint wash of its colour; a fully filled fail badge
 * would read as an alarm.
 */
export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const { p, corners, accentInk } = useTheme();
  const ink = {
    accent: accentInk,
    neutral: p.neutralInk,
    ok: p.okInk,
    fail: p.failInk,
    warn: p.warnInk,
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: softOn(ink, 0.15), ...corners.pill }]}>
      <Text style={[styles.badgeText, { color: ink }]}>{label}</Text>
    </View>
  );
}

/**
 * GlimStone's slosh dials for a bar's end, per motion level: one swing to each
 * wall and back in ms, how far the end surges out and how far it leans.
 */
const SLOSH: Record<MotionIntensity, { dur: number; surge: number; lean: number } | null> = {
  storm: { dur: 2600, surge: 7, lean: 18 },
  wild: { dur: 3600, surge: 5, lean: 12 },
  subtle: { dur: 5000, surge: 3.5, lean: 8 },
  off: null,
};

/**
 * The end of a fill level, which surges out leaning forward and draws back.
 * It never runs under Android's reduce motion, not even in the storm, since it
 * never ends.
 */
function SloshEnd({ color }: { color: string }) {
  const { intensity } = useMotion();
  const reduced = useSystemReduced();
  const dials = reduced ? null : SLOSH[intensity];
  const phase = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!dials) return;
    phase.setValue(0);
    const loop = Animated.loop(
      Animated.timing(phase, { toValue: 1, duration: dials.dur, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [dials, phase]);

  if (!dials) return null;
  const width = dials.surge + 2;
  const at = (share: number) => -width + dials.surge * share;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.sloshEnd,
        {
          width,
          backgroundColor: color,
          transform: [
            {
              translateX: phase.interpolate({
                inputRange: [0, 0.25, 0.5, 0.75, 1],
                outputRange: [at(0.4), at(0.15), at(0.4), at(1), at(0.4)],
              }),
            },
            {
              skewX: phase.interpolate({
                inputRange: [0, 0.25, 0.5, 0.75, 1],
                outputRange: ["0deg", `${dials.lean * 0.5}deg`, "0deg", `${-dials.lean}deg`, "0deg"],
              }),
            },
          ],
        },
      ]}
    />
  );
}

/**
 * A filled track for progress and for how full a target is. A total of zero
 * draws an empty track rather than a NaN width, which would render full. A
 * fill level sloshes at its end; a transfer's progress does not.
 */
export function Meter({ done, total, hue, slosh = false }: { done: number; total: number; hue?: string; slosh?: boolean }) {
  const { p, corners, accent } = useTheme();
  const { intensity, ms } = useMotion();
  const fill = hue ?? accent;
  const part = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;

  // A driven value rather than a layout animation, since only the fill's width
  // changes. Width cannot use the native driver, which is affordable because
  // the callers throttle their updates.
  const width = useRef(new Animated.Value(part)).current;
  useEffect(() => {
    if (!ms.layout) {
      width.setValue(part);
      return;
    }
    // Critical damping for this spring is near 20, so both spring levels
    // overshoot visibly.
    const run = ms.spring
      ? Animated.spring(width, {
          toValue: part,
          useNativeDriver: false,
          damping: 22 * ms.damping,
          stiffness: 140,
          mass: 0.7,
        })
      : Animated.timing(width, { toValue: part, useNativeDriver: false, duration: ms.layout });
    run.start();
    return () => run.stop();
  }, [part, ms.layout, ms.spring, width, intensity]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: Math.max(total, 0), now: Math.max(0, Math.min(done, total)) }}
      style={[styles.meter, { backgroundColor: p.surface2, ...corners.pill }]}
    >
      <Animated.View
        style={[
          styles.meterFill,
          {
            backgroundColor: fill,
            ...corners.pill,
            // Clamped again, since the spring overshoots past the track's end.
            width: width.interpolate({
              inputRange: [0, 1],
              outputRange: ["0%", "100%"],
              extrapolate: "clamp",
            }),
          },
        ]}
      >
        {slosh && part > 0 ? <SloshEnd color={fill} /> : null}
      </Animated.View>
    </View>
  );
}

/**
 * An (i) that opens its explanation in a small dialog on tap, since a phone
 * has no hover and a tooltip inside a narrow tile would wrap badly.
 */
export function InfoBubble({ tip, on }: { tip: string; on?: string }) {
  const { p, corners, accentInk } = useTheme();
  const { ms } = useMotion();
  const [open, setOpen] = useState(false);
  // `on` is the ink of the surface underneath, such as a notch filled with
  // the accent; otherwise the (i) takes the accent.
  const ink = on ?? accentInk;
  return (
    <>
      <Press
        onPress={() => setOpen(true)}
        // Often sits on a pressable tile.
        hitSlop={8}
        style={[styles.bubble, { backgroundColor: softOn(ink, on ? 0.22 : 0.15), ...corners.pill }]}
      >
        <Text style={[styles.bubbleMark, { color: ink }]}>i</Text>
      </Press>
      {/* The platform fade follows Android's animator scale; the motion
          setting decides whether it runs at all. */}
      <Modal
        visible={open}
        transparent
        animationType={ms.fade ? "fade" : "none"}
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={[styles.tipGround, { backgroundColor: p.scrim }]} onPress={() => setOpen(false)}>
          <View style={[styles.tipCard, { backgroundColor: p.surface2, ...corners.card }]}>
            <Text style={[styles.tipText, { color: p.text }]}>{tip}</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * A labelled button that follows the label setting. Its glyph comes from the
 * translation key through the web app's rule table; a button without a glyph
 * shows its word in every mode.
 *
 * `tone`: `accent` fills with the hue; `neutral` keeps the neutral surface and
 * text ink, since a coloured word on grey reads as a link; `danger` uses the
 * fail colour as ink; `ok` and `fail` fill with the status colour to show a
 * result. `danger`, `ok` and `fail` ignore `hue`.
 *
 * `shake` is a counter: every increment runs one wobble.
 */
export function Button({
  label,
  labelKey,
  mark,
  onPress,
  tone = "neutral",
  hue,
  busy,
  disabled,
  wide,
  shake,
  confirm,
  glyph: named,
  hint,
}: {
  label: string;
  /** The translation key behind `label`, which picks the glyph. */
  labelKey?: string;
  /** A glyph name overriding the one `labelKey` would pick. */
  glyph?: string;
  /**
   * An explicit mark, such as a brand logo, drawn from the ink this button
   * computes.
   */
  mark?: (ink: string) => ReactNode;
  onPress: () => void;
  tone?: "accent" | "neutral" | "danger" | "ok" | "fail";
  /** This button's position among its siblings, for the rainbow. */
  hue?: number;
  busy?: boolean;
  disabled?: boolean;
  wide?: boolean;
  /** Increment to wobble once. */
  shake?: number;
  /** Increment to swell once, when what the button did has landed. */
  confirm?: number;
  /** The "(i)" at the end of the button, for what the name cannot say. */
  hint?: string;
}) {
  const { p, corners, labels, accent, hueAt } = useTheme();
  const { ms } = useMotion();
  const fill = (hue !== undefined ? hueAt(hue) : undefined) ?? accent;
  const ground =
    tone === "accent" ? fill : tone === "ok" ? p.okSolid : tone === "fail" ? p.failSolid : p.surface2;
  const ink =
    tone === "accent" || tone === "ok" || tone === "fail"
      ? contrastOn(ground)
      : tone === "danger"
        ? p.failInk
        : p.text;

  // The wobble runs on the native driver, since it fires while the screen
  // re-renders with the result. At `off` its durations are zero.
  const wobble = useRef(new Animated.Value(0)).current;
  const press = usePress();
  const swell = useConfirm();
  useEffect(() => {
    if (confirm) swell.confirm();
  }, [confirm, swell.confirm]);
  useEffect(() => {
    if (!shake) return;
    const leg = Math.max(1, Math.round(ms.fade / 2));
    Animated.sequence(
      [1, -1, 0.6, -0.6, 0].map((to) =>
        Animated.timing(wobble, { toValue: to, duration: leg, useNativeDriver: true }),
      ),
    ).start();
  }, [shake, ms.fade, wobble]);

  const name = named ?? (labelKey ? glyphNameForKey(labelKey) : undefined);
  const glyph = mark ? mark(ink) : name ? <Glyph name={name} color={ink} /> : null;
  const showWord = labels === "text" || labels === "textGlyph" || !glyph;
  const showGlyph = Boolean(glyph) && labels !== "text";

  const button = (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: p.hover }}
      style={[
        styles.button,
        {
          backgroundColor: ground,
          ...corners.pill,
          opacity: disabled || busy ? 0.45 : press.dim,
          flexGrow: wide === false ? 0 : 1,
          transform: [
            { translateX: wobble.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] }) },
            { scale: press.scale },
            { scale: swell.scale },
          ],
        },
      ]}
    >
      {busy ? <ActivityIndicator color={ink} size="small" /> : showGlyph ? glyph : null}
      {showWord ? (
        <Text style={[styles.buttonText, { color: ink }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </AnimatedPressable>
  );
  if (!hint) return button;
  // As on the README buttons, the (i) lies over the button's end as its
  // sibling, so tapping it opens the bubble and not what the button does.
  return (
    <View style={{ flexGrow: wide === false ? 0 : 1 }}>
      {button}
      <View style={styles.readmeHint} pointerEvents="box-none">
        <InfoBubble tip={hint} on={tone === "neutral" || tone === "danger" ? undefined : ink} />
      </View>
    </View>
  );
}

/** The width of the README's own buttons. */
export const README_W = 160;

export const README_GAP = 13;

const ReadmeWidth = createContext<number | undefined>(undefined);

/**
 * README buttons side by side, as many across as fit at the README's width and
 * sharing the row between them, so the row reaches the card's edge on any phone.
 */
export function ReadmeRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [room, setRoom] = useState(0);
  const across = Math.max(1, Math.floor((room + README_GAP) / (README_W + README_GAP)));
  const width = room ? Math.floor((room - README_GAP * (across - 1)) / across) : undefined;
  return (
    <View style={[styles.readmeRow, style]} onLayout={(e) => setRoom(e.nativeEvent.layout.width)}>
      <ReadmeWidth.Provider value={width}>{children}</ReadmeWidth.Provider>
    </View>
  );
}

/**
 * A button in the shape of the README's, as GlimStone's About card has it: 46.6
 * high and 160 wide, or its share of a ReadmeRow, the brand's mark and the name
 * on the quiet ground at rest, the brand's own colour and its ink while a
 * finger is on it. A phone has no pointer to light it earlier.
 */
export function ReadmeButton({
  label,
  sub,
  mark,
  art,
  tile,
  hint,
  onPress,
  soon,
  confirm,
}: {
  label: string;
  /** A second, smaller line under the name. */
  sub?: string;
  /** The mark in its resting colours, or in `ink` while lit. */
  mark: (lit: boolean, ink: string) => ReactNode;
  /** The mark is the vendor's own button artwork, words included. */
  art?: boolean;
  /** The lit fill and the ink that holds on it. */
  tile: { color: string; ink: string };
  /** The "(i)" at the end of the button, for what the name cannot say. */
  hint?: string;
  /** Where the route leads. Without one it is not open yet: the second line
   *  says `soon`, the button stays unlit and the mark pales, as on the web. */
  onPress?: () => void;
  soon?: string;
  /** Increment to swell once, when what the button did has landed. */
  confirm?: number;
}) {
  const { p, corners } = useTheme();
  const width = useContext(ReadmeWidth) ?? README_W;
  const press = usePress();
  const swell = useConfirm();
  useEffect(() => {
    if (confirm) swell.confirm();
  }, [confirm, swell.confirm]);
  const [lit, setLit] = useState(false);
  const shut = !onPress;
  const ink = lit ? tile.ink : shut ? p.textSub : p.text;
  const button = (
    <AnimatedPressable
      onPress={onPress}
      disabled={shut}
      onPressIn={() => {
        setLit(true);
        press.onPressIn();
      }}
      onPressOut={() => {
        setLit(false);
        press.onPressOut();
      }}
      accessibilityRole="button"
      accessibilityLabel={shut && soon ? `${label}, ${soon}` : label}
      accessibilityState={{ disabled: shut }}
      style={[
        styles.readme,
        art ? styles.readmeArt : null,
        {
          width,
          backgroundColor: lit ? tile.color : p.surface2,
          ...corners.pill,
          transform: [{ scale: press.scale }, { scale: swell.scale }],
        },
      ]}
    >
      {art ? (
        mark(lit, ink)
      ) : (
        <>
          <View style={[styles.readmeMark, shut ? styles.readmeMarkShut : null]}>{mark(lit, ink)}</View>
          <View style={[styles.readmeName, hint ? styles.readmeNameHint : null]}>
            <Text style={[styles.readmeNameText, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit>
              {label}
            </Text>
            {(shut ? soon : sub) ? (
              <Text style={[styles.caption, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit>
                {shut ? soon : sub}
              </Text>
            ) : null}
          </View>
        </>
      )}
    </AnimatedPressable>
  );
  if (!hint) return button;
  // The (i) lies over the button's end as its sibling, so tapping it opens the
  // bubble and not what the button does.
  return (
    <View style={{ width }}>
      {button}
      <View style={styles.readmeHint} pointerEvents="box-none">
        <InfoBubble tip={hint} on={lit ? tile.ink : undefined} />
      </View>
    </View>
  );
}

// Created at module level; inside a component it would be a new type on every
// render and remount the button mid-animation.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The web app's switch: a track filled when on, with a knob. Drawn by hand
 * rather than with the platform Switch, so it follows the shape setting.
 */
export function Switcher({
  value,
  onChange,
  hue,
  disabled,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  hue?: number;
  disabled?: boolean;
}) {
  const { p, corners, accent, hueAt } = useTheme();
  const on = (hue !== undefined ? hueAt(hue) : undefined) ?? accent;
  return (
    <TouchableOpacity
      activeOpacity={HELD}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[
        styles.track,
        { ...corners.pill, backgroundColor: value ? on : p.surface3, opacity: disabled ? 0.45 : 1 },
      ]}
    >
      {/* The knob takes the page's ground colour rather than a fixed white. */}
      <View
        style={[
          styles.knob,
          { ...corners.pill, backgroundColor: p.background, alignSelf: value ? "flex-end" : "flex-start" },
        ]}
      />
    </TouchableOpacity>
  );
}

/**
 * A switch with its label. Normally the label names the setting; with `off`
 * given, the label names the current state instead ("Permission granted" or
 * not), for a switch that reports something decided elsewhere. A changing
 * label on a real setting would read like an instruction.
 */
export function Toggle({
  label,
  off,
  hint,
  value,
  onChange,
  disabled,
  hue,
}: {
  label: string;
  /** The label for the off state, when the row names a state. */
  off?: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hue?: number;
}) {
  return (
    <Row
      label={off !== undefined && !value ? off : label}
      hint={hint}
      control={<Switcher value={value} onChange={onChange} disabled={disabled} hue={hue} />}
    />
  );
}

/**
 * The horizontal selector: a groove one surface deeper with equal segments,
 * where only the chosen segment is filled. Under the rainbow the selectors on
 * a screen count through the palette in the order they stand, so `hue` is
 * this one's place among them.
 */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  hue,
  disabled,
  perRow,
  style,
}: {
  /**
   * `hint` puts an (i) in its segment that explains that one option. `mark`
   * is drawn in place of the label, which is then only read out. `glyph`
   * names a glyph that stands beside the label or for it, as the label
   * setting says, like a button's. A `disabled` option is dimmed and cannot
   * be chosen; the screen says why.
   */
  options: {
    value: T;
    label: string;
    colour?: string;
    hint?: string;
    mark?: (ink: string) => ReactNode;
    glyph?: string;
    disabled?: boolean;
  }[];
  value: T;
  onChange: (next: T) => void;
  hue?: number;
  /** Dimmed and inert, but still showing the value in force. */
  disabled?: boolean;
  /**
   * How many segments share a row, for more than one row holds: they wrap
   * into even rows, each segment as wide as the others in its row.
   */
  perRow?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { p, corners, accent, hueAt } = useTheme();
  const mine = (hue !== undefined ? hueAt(hue) : undefined) ?? accent;
  // A share of the row that leaves room for the gaps; growing fills the rest.
  const basis: DimensionValue | undefined = perRow ? `${Math.floor(100 / perRow) - 4}%` : undefined;
  return (
    <View
      pointerEvents={disabled ? "none" : "auto"}
      style={[
        styles.well,
        { backgroundColor: p.surface2, ...corners.pill },
        basis ? styles.wrapped : null,
        disabled ? styles.dimmed : null,
        style,
      ]}
    >
      {options.map((option) => {
        const on = option.value === value;
        const fill = option.colour ?? mine;
        return (
          <Segment
            key={option.value}
            option={option}
            on={on}
            fill={fill}
            basis={basis}
            onPress={() => onChange(option.value)}
          />
        );
      })}
    </View>
  );
}

/** One segment of a selector, giving way and dimming under a finger. */
function Segment({
  option,
  on,
  fill,
  basis,
  onPress,
}: {
  option: { label: string; hint?: string; mark?: (ink: string) => ReactNode; glyph?: string; disabled?: boolean };
  on: boolean;
  fill: string;
  basis?: DimensionValue;
  onPress: () => void;
}) {
  const { p, corners, labels } = useTheme();
  const press = usePress();
  const ink = on ? contrastOn(fill) : p.textSub;
  const glyph = option.glyph && labels !== "text" ? <Glyph name={option.glyph} color={ink} /> : null;
  const word = !option.mark && (!glyph || labels !== "glyph");
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={option.disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: option.disabled }}
      accessibilityLabel={word ? undefined : option.label}
      style={[
        styles.segment,
        option.hint || (glyph && word) ? styles.segmentRow : null,
        corners.pill,
        basis ? { flexBasis: basis } : null,
        on ? { backgroundColor: fill } : null,
        { opacity: press.dim, transform: [{ scale: press.scale }] },
        option.disabled ? styles.dimmed : null,
      ]}
    >
      {option.mark ? option.mark(ink) : glyph}
      {word ? (
        <Text
          numberOfLines={1}
          // Shrinks rather than truncates with an ellipsis, down to 0.7;
          // below that the strip has too many segments.
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={[styles.segmentText, { color: ink }]}
        >
          {option.label}
        </Text>
      ) : null}
      {/* Its own press target, so reading it does not choose it. */}
      {option.hint ? <InfoBubble tip={option.hint} on={on ? ink : undefined} /> : null}
    </AnimatedPressable>
  );
}

/**
 * A colour swatch, sized by its row. The current one is marked by a ring of
 * nested views rather than a border.
 */
export function Swatch({
  hex,
  selected,
  onPress,
  label,
}: {
  hex: string;
  selected: boolean;
  onPress: () => void;
  label: string;
}) {
  const { p, corners } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={HELD}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.swatchRing, { ...corners.pill, backgroundColor: selected ? p.text : "transparent" }]}
    >
      <View
        style={[
          styles.swatchGap,
          { ...corners.pill, backgroundColor: selected ? p.surface : "transparent" },
        ]}
      >
        <View style={[styles.swatchFill, { ...corners.pill, backgroundColor: hex }]} />
      </View>
    </TouchableOpacity>
  );
}

/**
 * The round mark a row is picked with, never a switch or a checkbox: grey at
 * rest, filled and ticked once its row is chosen. A touch screen has no hover
 * to bring it in, so it stays in view.
 */
export function SelectMark({ on }: { on: boolean }) {
  const { p, corners, accent } = useTheme();
  return (
    <View style={[styles.mark, { ...corners.pill, backgroundColor: on ? accent : p.surface3 }]}>
      {on ? <Glyph name="IconCheck" color={contrastOn(accent)} size={12} /> : null}
    </View>
  );
}

/**
 * A row that is picked by tapping it, its mark at the start. A picked row is a
 * deeper fill and nothing else, so no edge line marks it.
 */
export function PickRow({
  on,
  onPress,
  label,
  disabled,
  children,
}: {
  on: boolean;
  onPress: () => void;
  /** What a screen reader says for the row. */
  label?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { p, corners } = useTheme();
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      accessibilityLabel={label}
      android_ripple={{ color: p.hover }}
      style={[styles.pickRow, { backgroundColor: on ? p.surface2 : p.surface, ...corners.control }]}
    >
      <SelectMark on={on} />
      <View style={styles.pickBody}>{children}</View>
    </Press>
  );
}

/** A message in place of an empty or loading list, so it does not look broken. */
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.empty}>
      <Title>{title}</Title>
      {detail ? <Body muted>{detail}</Body> : null}
    </View>
  );
}

/**
 * A scrolling page. `fab` adds room at the bottom so a floating button does
 * not cover the last row.
 */
export function Page({
  children,
  fab,
  scroll,
}: {
  children: ReactNode;
  fab?: boolean;
  /** From usePageScroll, for a page that brings a part of itself into view. */
  scroll?: PageScroll;
}) {
  const { p } = useTheme();
  const motion = useScrollMotion();
  return (
    <Animated.View style={motion.style}>
      <ScrollView
        ref={scroll?.scroller}
        innerViewRef={scroll?.inner as RefObject<View> | undefined}
        {...motion.scroll}
        style={{ backgroundColor: p.background }}
        contentContainerStyle={[styles.page, fab ? styles.fabRoom : null]}
        keyboardShouldPersistTaps="handled"
      >
        <Arrival.Provider value={motion.line}>{children}</Arrival.Provider>
      </ScrollView>
    </Animated.View>
  );
}

export type PageScroll = ReturnType<typeof usePageScroll>;

/**
 * Lets a page scroll to one of its parts, such as the field a refused save
 * names. `reveal` takes a ref to a view anywhere inside the page.
 */
export function usePageScroll() {
  const { ms } = useMotion();
  const scroller = useRef<ScrollView>(null);
  const inner = useRef<View>(null);
  const animated = ms.layout > 0;
  const reveal = useCallback(
    (target: RefObject<View | null>) => {
      const box = inner.current;
      if (!box || !target.current) return;
      target.current.measureLayout(
        box,
        (_x, y) => scroller.current?.scrollTo({ y: Math.max(0, y - space.xl), animated }),
        () => {},
      );
    },
    [animated],
  );
  return { scroller, inner, reveal };
}

/** The room every page keeps below its last row, so a floating button covers nothing. */
export const FAB_ROOM = 96;

/**
 * The floating button at the bottom right, where the thumb rests. Above the
 * bar it shows its glyph alone in every label mode and its label is what a
 * screen reader says; a key with no glyph keeps its word.
 */
export function Fab({
  label,
  labelKey,
  onPress,
}: {
  label: string;
  /** The translation key behind `label`, which picks the glyph. */
  labelKey?: string;
  onPress: () => void;
}) {
  const { p, corners, accent } = useTheme();
  const press = usePress();
  const ink = contrastOn(accent);
  const name = labelKey ? glyphNameForKey(labelKey) : undefined;

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: p.hover, borderless: false }}
      style={[
        styles.fab,
        {
          backgroundColor: accent,
          // A pill radius on a square box is a circle.
          ...corners.pill,
          paddingHorizontal: name ? 0 : space.lg,
          width: name ? TOUCH + space.sm : undefined,
          opacity: press.dim,
          transform: [{ scale: press.scale }],
        },
      ]}
    >
      {name ? (
        <Glyph name={name} color={ink} size={22} />
      ) : (
        <Text numberOfLines={1} style={[styles.fabText, { color: ink }]}>
          {label}
        </Text>
      )}
    </AnimatedPressable>
  );
}

/**
 * A container for a list and a floating button as siblings, so the button
 * does not scroll with the rows.
 */
export function Floating({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // Every page sits under a title bar, which already leaves room above.
  page: { padding: space.lg, paddingTop: space.xs, gap: space.md },
  card: { padding: space.lg, gap: space.sm, overflow: "hidden" },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },

  // Room for the notch above: the badge is 22 tall and overlaps by 11.
  notchWrap: { marginTop: space.md + 11 },
  notchCard: { paddingTop: space.xl, paddingBottom: space.md, paddingHorizontal: space.lg, gap: space.sm },
  notch: {
    position: "absolute",
    top: -11,
    left: space.lg,
    // No `right`, which would stretch the badge across the card; the cap keeps
    // a long title on it.
    maxWidth: "86%",
    minHeight: 22,
    paddingHorizontal: space.md,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  notchText: { fontSize: text.meta, fontWeight: "500", textTransform: "uppercase", letterSpacing: 1.2 },

  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  rowText: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.sm },

  heading: { fontSize: text.status, fontWeight: "600" },
  title: { fontSize: text.title, fontWeight: "600" },
  body: { fontSize: text.body },
  caption: { fontSize: text.subline, lineHeight: 18 },
  pair: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  pairLabel: { fontSize: text.body, flexShrink: 0 },
  pairValue: { fontSize: text.body, fontWeight: "600", flex: 1, textAlign: "right" },
  axis: { fontSize: text.meta, fontWeight: "500", textTransform: "uppercase", letterSpacing: 1.2 },
  axisRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  mono: { fontFamily: "monospace", fontSize: text.meta },

  cardHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  cardHeadMark: { width: 36, alignItems: "center" },
  // A long name yields to the badge and menu beside it.
  cardHeadTitle: { fontSize: text.title, fontWeight: "600", flexShrink: 1 },
  // `center` keeps a badge from stretching without overriding the row's
  // vertical centring.
  badge: { paddingHorizontal: 7, paddingVertical: 2, alignSelf: "center", flexShrink: 0 },
  badgeText: { fontSize: text.meta, fontWeight: "600", letterSpacing: 0.2 },
  // The fill is a share of the track's width, so the track has to take the
  // full width even in a column that packs its children to the start.
  meter: { height: 6, overflow: "hidden", alignSelf: "stretch" },
  meterFill: { height: "100%" },
  sloshEnd: { position: "absolute", left: "100%", top: 0, bottom: 0, borderTopRightRadius: 999, borderBottomRightRadius: 999 },
  bubble: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  bubbleMark: { fontSize: text.meta, fontWeight: "700", lineHeight: text.meta + 3 },
  tipGround: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.lg,
  },
  tipCard: { maxWidth: 320, padding: space.lg },
  tipText: { fontSize: text.body, lineHeight: text.body + 6 },

  // The bottom bar reserves its own height, so `space.lg` clears it.
  fab: {
    position: "absolute",
    right: space.lg,
    bottom: space.lg,
    minHeight: TOUCH + space.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    elevation: 6,
  },
  fabText: { fontSize: text.body, fontWeight: "600" },
  fabRoom: { paddingBottom: FAB_ROOM },

  button: {
    minHeight: TOUCH,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  buttonText: { fontSize: text.body, fontWeight: "600", flexShrink: 1 },
  // The README's proportions: the mark 24 in from the start, the name from 63.
  readmeRow: { flexDirection: "row", flexWrap: "wrap", gap: README_GAP },
  readme: { height: 46.6, overflow: "hidden", justifyContent: "center" },
  // Vendor artwork keeps the README's width inside a wider button.
  readmeArt: { alignItems: "center" },
  readmeMark: { position: "absolute", start: 24, top: 10.8, width: 32, height: 25 },
  readmeName: { flex: 1, justifyContent: "center", marginStart: 63, marginEnd: 10 },
  readmeNameText: { fontSize: text.body, fontWeight: "700" },
  readmeNameHint: { marginEnd: 28 },
  readmeMarkShut: { opacity: 0.45 },
  readmeHint: { position: "absolute", top: 0, bottom: 0, end: 10, justifyContent: "center" },

  track: { width: 36, height: 20, padding: 2, justifyContent: "center" },
  knob: { width: 16, height: 16 },

  // The segments divide the card's width rather than sizing to their words,
  // so none runs off the edge.
  well: { flexDirection: "row", padding: 3, gap: 2, alignSelf: "stretch" },
  wrapped: { flexWrap: "wrap" },
  // Centred for when the groove stretches to a neighbouring button's height.
  segment: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 7,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: { fontSize: text.meta, fontWeight: "500", flexShrink: 1 },
  segmentRow: { flexDirection: "row", gap: 4 },

  swatchRing: { flex: 1, maxWidth: 32, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  swatchGap: { width: "88%", height: "88%", alignItems: "center", justifyContent: "center" },
  swatchFill: { width: "86%", height: "86%" },

  dimmed: { opacity: 0.4 },
  held: { opacity: HELD },
  // The notch's room above, the card's padding at its sides and ends.
  listTop: { height: space.xl },
  listPiece: { paddingHorizontal: space.lg },
  listEnd: { height: space.md },
  sheetGround: { flex: 1, justifyContent: "flex-end", paddingHorizontal: space.md },
  sheet: { maxHeight: "88%", overflow: "hidden", elevation: 8 },
  sheetHead: { paddingHorizontal: space.lg, paddingTop: space.lg },
  sheetTitle: { alignSelf: "flex-start", paddingHorizontal: space.md, paddingVertical: 3 },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetBody: { padding: space.lg, gap: space.md },
  sheetFoot: { flexDirection: "row", justifyContent: "flex-end", padding: space.lg, paddingTop: 0 },
  mark: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  pickBody: { flex: 1, minWidth: 0, gap: space.xs },
  empty: { padding: space.xxl, gap: space.sm, alignItems: "center" },
});

export { GLYPH };
