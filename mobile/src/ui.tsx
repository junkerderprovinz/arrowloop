import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Glyph, glyphNameForKey, GLYPH } from "./glyphs";
import {
  contrastOn,
  inkFor,
  palettes,
  RAINBOW,
  radiusFor,
  softOn,
  space,
  text,
  TOUCH,
  type Palette,
  type Radii,
} from "./theme";
import { useAppearance, type LabelMode } from "./settings";

/**
 * The GlimStone controls, as React Native.
 *
 * This file was rewritten because the screens were drawn with borders, loose
 * grey captions and the platform's own switch while the product they connect to
 * draws notch badges, well selectors and filled switches. jdp: "Auch alle
 * toggles und buttons etc sollen wie in Glimmstone aussehen." The shapes and
 * numbers here are the design language's, not approximations: the notch is 22
 * tall and overlaps its card by half, the well is a groove one surface deeper
 * whose CHOSEN segment is the only badge, the switch is a 36x20 track with a
 * 16 knob.
 *
 * NO BORDERS ANYWHERE, which is the rule the old file broke in the most places
 * at once: GlimStone separates surfaces by shade, never by a drawn line. Every
 * `borderWidth` that used to be here was a line the language does not have.
 *
 * Every radius comes from the shape engine at render time. A number baked into
 * a StyleSheet cannot follow a setting, and that is precisely how the corner
 * selector came to look like it did nothing.
 */

export interface Theme {
  p: Palette;
  radius: Radii;
  labels: LabelMode;
  rainbow: boolean;
  scheme: "dark" | "light";
  accent: string;
  accentContrast: string;
  /** The accent darkened enough to be READ on this scheme's ground. */
  accentInk: string;
  /** The colour for one position in a set, or undefined with the mode off. */
  hueAt: (index: number) => string | undefined;
}

export function useTheme(): Theme {
  const system = useColorScheme() === "light" ? "light" : "dark";
  const a = useAppearance();
  const scheme = a.theme === "system" ? system : a.theme;
  const base = palettes[scheme];
  return {
    scheme,
    p: base,
    radius: radiusFor(a.shape),
    // `reactive` never reaches a control here: a phone has no pointer, so a
    // label that appears under one is a label nobody ever sees. A stored value
    // from an older build resolves to symbols, which is what it looked like
    // anyway. See settings.ts for the whole reasoning.
    labels: a.labels === "reactive" ? "glyph" : a.labels,
    rainbow: a.rainbow,
    accent: a.accent,
    accentContrast: contrastOn(a.accent),
    accentInk: inkFor(a.accent, scheme),
    // The EDITED palette where there is one, the shipped colours otherwise.
    // Empty rather than a stored copy of the defaults, so an install that has
    // never opened the palette follows the defaults when they change.
    hueAt: (index: number) => {
      if (!a.rainbow) return undefined;
      const set = a.palette.length ? a.palette : RAINBOW;
      // The offset, so a page does not always open on the same colour. Zero
      // unless the switch is on, which is what makes turning it off put every
      // colour back where it was rather than somewhere new.
      const off = a.rainbowRotate ? a.rainbowSeed : 0;
      const n = ((Math.trunc(index) % set.length) + set.length) % set.length;
      return set[(n + off) % set.length];
    },
  };
}

export function usePalette(): Palette {
  return useTheme().p;
}

/** The colour one member of a set gets, by position. Off, everything is the
 *  accent - which is what the app looks like unless somebody asked for more. */
export function useHue(index: number): string {
  const { accent, hueAt } = useTheme();
  return hueAt(index) ?? accent;
}

export function Screen({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <View style={[styles.screen, { backgroundColor: p.background }]}>{children}</View>;
}

/**
 * A plain surface. No border, no title: one shade above the page and nothing
 * else, which is how this language says "these things belong together".
 *
 * A card that owns a rainbow position carries it as a filled edge rather than a
 * drawn line - the same block of colour the web lays down, not a 1px rule.
 */
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
  const { p, radius, rainbow } = useTheme();
  const body = (
    <View style={[styles.card, { backgroundColor: p.surface, borderRadius: radius.card }, style]}>
      {rainbow && hue ? (
        <View
          style={[
            styles.edge,
            { backgroundColor: hue, borderTopLeftRadius: radius.card, borderBottomLeftRadius: radius.card },
          ]}
        />
      ) : null}
      {children}
    </View>
  );
  if (!onPress) return body;
  // `android_ripple` rather than an opacity change, because a ripple is what
  // every other app on the phone does and the difference is felt rather than
  // seen. The one place this build deliberately does not copy the web's hover
  // ramp: there is no pointer to hover.
  return (
    <Pressable onPress={onPress} android_ripple={{ color: p.hover }} style={{ borderRadius: radius.card }}>
      {body}
    </Pressable>
  );
}

/**
 * A card with its title as a NOTCH: a filled badge sitting half over the top
 * edge, which is the shape this family's settings pages are built from.
 *
 * The title is not a heading inside the card. A heading inside is a line of
 * text that has to be told apart from the rows below it by size alone; the
 * notch is a different object entirely, so the eye never has to.
 */
export function Section({
  title,
  hint,
  hue,
  children,
}: {
  title: string;
  hint?: string;
  /** This card's position among the page's cards, 0-based. */
  hue?: number;
  children: ReactNode;
}) {
  const { p, radius, accent, accentContrast, hueAt } = useTheme();
  const fill = (hue !== undefined ? hueAt(hue) : undefined) ?? accent;
  const ink = contrastOn(fill) || accentContrast;
  return (
    <View style={styles.notchWrap}>
      <View style={[styles.notchCard, { backgroundColor: p.surface, borderRadius: radius.card }]}>
        {children}
      </View>
      {/* THE EXPLANATION LIVES IN THE NOTCH, beside the title, which is where
          the container puts it too.

          It used to float in the card's top-right corner, and on a card whose
          first row is a well or a switch that put the (i) somewhere between two
          controls it did not belong to: jdp, on the corners card, "einige i
          infobubbles sind schlecht platziert". A card has exactly two things
          that describe the whole card - its name and its reason - and they
          belong together on its rim, so the inside holds only what the card is
          FOR. The badge is also where the eye already is when somebody is
          working out what a card does. */}
      <View style={[styles.notch, { backgroundColor: fill, borderRadius: radius.pill }]}>
        <Text style={[styles.notchText, { color: ink }]} numberOfLines={1}>
          {title}
        </Text>
        {hint ? <InfoBubble tip={hint} on={ink} /> : null}
      </View>
    </View>
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
      {/* Beside the label in an (i), like every other explanation in the app.
          A row is a label and a control on one line, and a second line of grey
          prose under half of the rows is what made a settings card read as a
          list of paragraphs with switches attached. */}
      <View style={styles.rowText}>
        <Text style={[styles.body, { color: p.text, flexShrink: 1 }]}>{label}</Text>
        {hint ? <InfoBubble tip={hint} /> : null}
      </View>
      {control}
    </View>
  );
  return onPress ? <TouchableOpacity onPress={onPress}>{body}</TouchableOpacity> : body;
}

export function Heading({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <Text style={[styles.heading, { color: p.text }]}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <Text style={[styles.title, { color: p.text }]}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const { p } = useTheme();
  return <Text style={[styles.body, { color: muted ? p.textMuted : p.textSub }]}>{children}</Text>;
}

export function Caption({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <Text style={[styles.caption, { color: p.textMuted }]}>{children}</Text>;
}

/** A small uppercase label naming an axis above its control. */
export function AxisLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  const { p } = useTheme();
  if (!hint) return <Text style={[styles.axis, { color: p.textSub }]}>{children}</Text>;
  // An axis can need explaining too, and it gets the same (i) as everything
  // else rather than a paragraph under the control it introduces.
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
 * A status word on a ground in that status's own colour.
 *
 * The ground is the status colour at low opacity and the ink is the solid: a
 * fully filled badge in the fail colour reads as an alarm, and a target that
 * has not been reached yet is not an alarm. No border - the tinted ground is
 * what separates it, the way every surface in this language is separated.
 */
export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const { p, radius, accentInk } = useTheme();
  const ink = {
    accent: accentInk,
    neutral: p.neutralInk,
    ok: p.okInk,
    fail: p.failInk,
    warn: p.warnInk,
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: softOn(ink, 0.15), borderRadius: radius.pill }]}>
      <Text style={[styles.badgeText, { color: ink }]}>{label}</Text>
    </View>
  );
}

/**
 * An explanation, folded into an (i) until somebody asks for it.
 *
 * The house rule is that prose belongs in a bubble rather than in the thing it
 * explains, and the tile grid is where that rule earns its keep: five of the
 * sixty entries carry a sentence, and printed in place those five tiles stand
 * taller than the fifty-five around them - a grid of one size becomes a grid of
 * two because of five sentences nobody needed.
 *
 * A TAP rather than a hover, and a small dialog rather than a tooltip pinned to
 * the corner. A phone has no pointer, so the web's reveal-on-hover has no
 * gesture behind it at all; and a bubble anchored inside a tile that is 180
 * wide would wrap a sentence into eight lines. The dialog is the same text with
 * room to be read, and it leaves every tile the height it had.
 */
export function InfoBubble({ tip, on }: { tip: string; on?: string }) {
  const { p, radius, accentInk } = useTheme();
  const [open, setOpen] = useState(false);
  // `on` is the ink of the surface this sits on - a card notch hands in its own
  // contrast ink, because an accent-coloured (i) on an accent-coloured badge is
  // a mark nobody can see. Without it the bubble takes the accent, which is
  // right everywhere else: on a card it is the one accent-coloured thing in a
  // row of neutral controls, which is what makes it findable.
  const ink = on ?? accentInk;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        // The tile underneath is itself pressable, and a tap that opened the
        // form for a provider somebody was only reading about would be the
        // picker answering a question nobody asked.
        hitSlop={8}
        style={[styles.bubble, { backgroundColor: softOn(ink, on ? 0.22 : 0.15), borderRadius: radius.pill }]}
      >
        <Text style={[styles.bubbleMark, { color: ink }]}>i</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* The ground outside the card dismisses it. A dialog whose only way
            out is a button is a dialog somebody has to hunt through. */}
        <Pressable style={styles.tipGround} onPress={() => setOpen(false)}>
          <View style={[styles.tipCard, { backgroundColor: p.surface2, borderRadius: radius.card }]}>
            <Text style={[styles.tipText, { color: p.text }]}>{tip}</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * Every labelled button, and it answers the LABEL ENGINE like every control in
 * this house.
 *
 * The glyph is resolved from the button's own TRANSLATION KEY through the rule
 * table the web interface uses, so a button wears the same mark on both
 * surfaces and no call site has to name one. A key that matches no rule gets no
 * glyph, and a button with no glyph keeps its word in every mode - an empty box
 * somebody has to press to identify is the one failure worth ruling out.
 *
 * `reactive` resolves to the symbol alone here rather than revealing on hover,
 * because a phone has no hover: a label that appears under a pointer is a label
 * nobody on a phone will ever see.
 *
 * `tone`:
 *   - `accent` fills with the hue and takes contrasting ink.
 *   - `neutral` keeps the neutral surface and ordinary text ink. It does NOT
 *     put the hue in the ink: a coloured word on a grey ground reads as a link,
 *     and the point of the colour engine is that the pressable THING carries
 *     the colour.
 *   - `danger` is neutral with the fail colour in the ink, and it ignores
 *     `hue`: a delete button that turns teal because it is third in a palette
 *     has stopped warning anybody.
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
}: {
  label: string;
  /** The translation key behind `label`, which is what picks the glyph. */
  labelKey?: string;
  /**
   * An explicit drawing, for the call sites that mean a particular one - the
   * donation buttons, whose marks are BRANDS and therefore deliberately
   * unreachable through the rule table.
   *
   * A function of the ink rather than a finished element, because the ink is
   * computed here: a call site that had to work it out would be a second copy
   * of the tone table, and the first thing to go wrong would be a black coffee
   * cup on an accent-filled button.
   */
  mark?: (ink: string) => ReactNode;
  onPress: () => void;
  tone?: "accent" | "neutral" | "danger";
  /** This button's position among its siblings, for the rainbow. */
  hue?: number;
  busy?: boolean;
  disabled?: boolean;
  wide?: boolean;
}) {
  const { p, radius, labels, accent, hueAt } = useTheme();
  const fill = (hue !== undefined ? hueAt(hue) : undefined) ?? accent;
  const ground = tone === "accent" ? fill : p.surface2;
  const ink =
    tone === "accent" ? contrastOn(fill) : tone === "danger" ? p.failInk : p.text;

  const name = labelKey ? glyphNameForKey(labelKey) : undefined;
  const glyph = mark ? mark(ink) : name ? <Glyph name={name} color={ink} /> : null;
  const showWord = labels === "text" || labels === "textGlyph" || !glyph;
  const showGlyph = Boolean(glyph) && labels !== "text";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: p.hover }}
      style={[
        styles.button,
        {
          backgroundColor: ground,
          borderRadius: radius.control,
          opacity: disabled || busy ? 0.45 : 1,
          flexGrow: wide === false ? 0 : 1,
        },
      ]}
    >
      {busy ? <ActivityIndicator color={ink} size="small" /> : showGlyph ? glyph : null}
      {showWord ? (
        <Text style={[styles.buttonText, { color: ink }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The switch: a track, a knob, filled when on. The same object the web
 * interface draws, so somebody who flipped one there recognises this one.
 *
 * Both radii come from the shape engine. They were the platform's own `Switch`
 * before, which follows Android's shape rather than the app's - so on `square`
 * every other control in the app went rectangular and the switches stayed
 * capsules.
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
  const { p, radius, accent, hueAt } = useTheme();
  const on = (hue !== undefined ? hueAt(hue) : undefined) ?? accent;
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[
        styles.track,
        { borderRadius: radius.pill, backgroundColor: value ? on : p.surface3, opacity: disabled ? 0.45 : 1 },
      ]}
    >
      {/* The knob is the page's own ground sitting on the track, not a fixed
          white: it reads dark in dark mode and light in light mode. */}
      <View
        style={[
          styles.knob,
          { borderRadius: radius.pill, backgroundColor: p.background, alignSelf: value ? "flex-end" : "flex-start" },
        ]}
      />
    </TouchableOpacity>
  );
}

/** A labelled switch: the row and the control together, which is what every
 *  yes-or-no question here looks like. Never a checkbox. */
/**
 * A switch with its label, and the label may NAME THE STATE.
 *
 * Two things a switch's label can be, and they are not interchangeable:
 *
 *   - the SETTING, where the switch decides ("Only over Wi-Fi"). The label is
 *     the question and the switch is the answer.
 *   - the STATE, where the switch REPORTS something decided elsewhere
 *     ("Permission granted" / "Permission not granted"). The label is the
 *     answer, and pressing it goes to wherever the question is really asked.
 *
 * `off` opts a control into the second. Pass both labels and the row says what
 * IS rather than what could be - which is what a permission needs, because
 * "File access" beside a switch leaves somebody reading the switch's position
 * to work out a yes or a no that the row could simply have said (jdp: "der text
 * des Toggles soll Berechtigung erteilt heißen und wenn der toggle deaktiviert
 * ist soll es Berechtigung nicht erteilt heißen").
 *
 * WHY IT IS NOT THE DEFAULT: a label that changes can be read as a BUTTON's
 * label - does it say what is, or what happens if I press? On a reported state
 * that ambiguity cannot arise, because the switch's own position says the same
 * thing and the two reinforce each other. On a setting it would: "Only over
 * Wi-Fi off" reads like an instruction. So the state-naming label belongs
 * exactly where the switch is a READING of something this app does not own, and
 * nowhere else.
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
  /** The label for the OFF state, where the row names a state rather than a
   *  setting. Omit it and the label stands in both positions. */
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
 * The one horizontal selector: a groove one surface deeper, equal segments, and
 * only the CHOSEN segment is a badge. Never per-segment borders.
 *
 * Each segment owns a palette position, because they are members of one set the
 * way a tab strip's tabs are. Without that, the Theme and Corners rows stayed
 * flat accent on a page where every card around them had gone plural.
 */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string; colour?: string }[];
  value: T;
  onChange: (next: T) => void;
  /** Dimmed and inert, for a control whose answer is coming from somewhere
   *  else. It still SHOWS that answer, because hiding it would leave somebody
   *  unable to see what their job is actually set to. */
  disabled?: boolean;
}) {
  const { p, radius, accent, hueAt } = useTheme();
  return (
    <View
      pointerEvents={disabled ? "none" : "auto"}
      style={[
        styles.well,
        { backgroundColor: p.surface2, borderRadius: radius.control },
        disabled ? styles.dimmed : null,
      ]}
    >
      {options.map((option, i) => {
        const on = option.value === value;
        const fill = option.colour ?? hueAt(i) ?? accent;
        return (
          <TouchableOpacity
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, { borderRadius: radius.control }, on ? { backgroundColor: fill } : null]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.segmentText,
                // Computed against the fill it actually landed on, never a
                // fixed contrast: a palette position can be far lighter or
                // darker than the accent, and reusing one answer is how white
                // text ends up on a pale mint segment.
                { color: on ? contrastOn(fill) : p.textSub },
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * A colour swatch. The current one is marked by a RING - an inset gap in the
 * card colour, then the ink - drawn as nested views rather than a border,
 * because a border is a line and this language has none.
 *
 * Sized by the ROW rather than by a number here: eight swatches at a fixed size
 * plus a label do not fit across a phone, and picking a smaller fixed number
 * just moves the wrap to a narrower handset.
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
  const { p, radius } = useTheme();
  return (
    <TouchableOpacity
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.swatchRing, { borderRadius: radius.pill, backgroundColor: selected ? p.text : "transparent" }]}
    >
      <View
        style={[
          styles.swatchGap,
          { borderRadius: radius.pill, backgroundColor: selected ? p.surface : "transparent" },
        ]}
      >
        <View style={[styles.swatchFill, { borderRadius: radius.pill, backgroundColor: hex }]} />
      </View>
    </TouchableOpacity>
  );
}

/**
 * What an empty list says.
 *
 * Never a bare blank. An empty screen is indistinguishable from a broken one,
 * and on a phone there is no console to check - so every list that can be empty
 * says which of the two it is.
 */
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.empty}>
      <Title>{title}</Title>
      {detail ? <Body muted>{detail}</Body> : null}
    </View>
  );
}

/** A page that scrolls, with the house padding. */
export function Page({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: p.background }}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { padding: space.lg, gap: space.md },
  card: { padding: space.lg, gap: space.sm, overflow: "hidden" },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },

  // Room for the notch above: the badge is 22 tall and overlaps by 11.
  notchWrap: { marginTop: space.md + 11 },
  notchCard: { paddingTop: space.xl, paddingBottom: space.md, paddingHorizontal: space.lg, gap: space.sm },
  notch: {
    position: "absolute",
    top: -11,
    left: space.lg,
    // As wide as its contents and no wider. `left` alone does that; setting
    // `right` as well would STRETCH an absolutely positioned box across the
    // card, which turns a badge into a bar. The cap keeps a long title from
    // running off the edge on a narrow handset.
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
  notchText: { fontSize: text.caption, fontWeight: "500", textTransform: "uppercase", letterSpacing: 1.2 },

  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  // A row and its (i) on ONE line now, rather than a label with prose stacked
  // under it. `flexShrink` on the label is what keeps a long one from pushing
  // the bubble off the end of the row.
  rowText: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.sm },

  heading: { fontSize: text.heading, fontWeight: "600" },
  title: { fontSize: text.title, fontWeight: "600" },
  body: { fontSize: text.body },
  caption: { fontSize: text.caption, lineHeight: 16 },
  axis: { fontSize: text.caption, fontWeight: "500", textTransform: "uppercase", letterSpacing: 1.2 },
  axisRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  mono: { fontFamily: "monospace", fontSize: text.caption },

  badge: { paddingHorizontal: 7, paddingVertical: 2, alignSelf: "flex-start", flexShrink: 0 },
  badgeText: { fontSize: text.caption, fontWeight: "600", letterSpacing: 0.2 },
  bubble: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  bubbleMark: { fontSize: text.caption, fontWeight: "700", lineHeight: text.caption + 3 },
  tipGround: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.lg,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  tipCard: { maxWidth: 320, padding: space.lg },
  tipText: { fontSize: text.body, lineHeight: text.body + 6 },

  // ONE height and ONE gap for every labelled button. The gap matters: a row
  // with none sets the glyph against the first letter and the two read as one
  // smudge.
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

  track: { width: 36, height: 20, padding: 2, justifyContent: "center" },
  knob: { width: 16, height: 16 },

  // The groove takes the card's width and the segments divide it, rather than
  // each segment being as wide as its own word. With four of them and a fixed
  // minimum the last one simply ran off the edge of the card - and a segment
  // nobody can see is an option nobody can choose.
  well: { flexDirection: "row", padding: 3, gap: 2, alignSelf: "stretch" },
  segment: { flex: 1, minWidth: 0, paddingVertical: 7, paddingHorizontal: 6, alignItems: "center" },
  segmentText: { fontSize: text.dense, fontWeight: "500" },

  swatchRing: { flex: 1, maxWidth: 32, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  swatchGap: { width: "88%", height: "88%", alignItems: "center", justifyContent: "center" },
  swatchFill: { width: "86%", height: "86%" },

  dimmed: { opacity: 0.4 },
  empty: { padding: space.xxl, gap: space.sm, alignItems: "center" },
});

export { GLYPH };
