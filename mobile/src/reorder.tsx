import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View, type CellRendererProps, type GestureResponderEvent, type LayoutChangeEvent, type ViewProps } from "react-native";

import { dropIndex, type DropRect } from "../../web/src/lib/glimstone/dropIndex";
import { useMotion, useSystemReduced } from "./motion";

// A list's items put in a new order by a long press and a drag, the phone's
// side of the web's lib/dragLift.ts: the held item lifts and follows the
// finger, the others slide aside as it passes, and on release it settles into
// its gap, while the others tremble. React Native's own responder and Animated
// do it, so the app needs no gesture library.

/** How much the held item grows, per motion level, as the web's --drag-lift-scale. */
const LIFT = { off: 1, subtle: 1.015, wild: 1.03, storm: 1.06 } as const;

/**
 * How far the other items tilt, in degrees, and rise, in px, while one is
 * held, and one beat of it in ms, as the web's --motion-row-tremble-tilt,
 * --motion-row-tremble-lift and --motion-wiggle-dur. The phone's lists are one
 * column of rows as wide as the screen, whose ends a tile's turn would swing
 * far.
 */
const TREMBLE = {
  off: { tilt: 0, rise: 0, beat: 400 },
  subtle: { tilt: 0.1, rise: 1, beat: 140 },
  wild: { tilt: 0.15, rise: 1.5, beat: 120 },
  storm: { tilt: 0.2, rise: 2, beat: 100 },
} as const;

/** How many beats early every second and every third item starts, so neighbours tremble out of step. */
const PHASES = [0, 0.5, 0.33] as const;

/** Samples of one swing there and back, enough for the interpolation to read as a curve. */
const STEPS = 16;

interface Slot {
  y: number;
  height: number;
}

const box = (s: Slot): DropRect => ({ left: 0, top: s.y, width: 0, height: s.height });

/** What the list's cells need: which one is held, and where each one is. */
interface Cells {
  held: string | null;
  measure: (id: string, slot: Slot) => void;
}

const Lifted = createContext<Cells>({ held: null, measure: () => {} });

/** Around the list, so its cells know which one is held and report their places. */
export function MoveScope({ cells, children }: { cells: Cells; children: ReactNode }) {
  return <Lifted.Provider value={cells}>{children}</Lifted.Provider>;
}

export interface Reorder {
  /** The item in the hand, or null. */
  held: string | null;
  /** For an item's long press: lifts it under the finger. */
  lift: (id: string, e: GestureResponderEvent) => void;
  /** For an item's press out: puts a lifted item down where it is if the finger never moved. */
  release: () => void;
  /** Spread on a View around the list, which takes the finger over once an item is lifted. */
  catcher: ViewProps;
  /** The moving style for an item. */
  style: (id: string) => object;
  /** For MoveScope. */
  cells: Cells;
}

/**
 * The drag for a column of ids. `onReorder` gets the full new order after a
 * drop that changed it, and the caller draws the items in that order.
 */
export function useHoldToMove(ids: readonly string[], onReorder: (ids: string[]) => void): Reorder {
  const { intensity, ms } = useMotion();
  // Unlike the lift, the tremble yields to Android's setting at storm too.
  const reduced = useSystemReduced();
  const [held, setHeld] = useState<string | null>(null);
  const slots = useRef(new Map<string, Slot>());
  const shifts = useRef(new Map<string, Animated.Value>());
  const follow = useRef(new Animated.Value(0)).current;
  const grow = useRef(new Animated.Value(1)).current;
  const drag = useRef<{ id: string; startY: number; order: string[]; taken: boolean } | null>(null);
  // Set at a drop, so the offsets go only once the list is drawn in its new order.
  const landed = useRef(false);

  const idsRef = useRef(ids);
  idsRef.current = ids;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const shift = (id: string) => {
    let v = shifts.current.get(id);
    if (!v) {
      v = new Animated.Value(0);
      shifts.current.set(id, v);
    }
    return v;
  };

  const glide = (v: Animated.Value, toValue: number) => {
    if (ms.layout === 0) v.setValue(toValue);
    else Animated.timing(v, { toValue, duration: ms.layout / 2, useNativeDriver: true }).start();
  };

  const reset = () => {
    follow.setValue(0);
    grow.setValue(1);
    for (const v of shifts.current.values()) v.setValue(0);
  };

  useLayoutEffect(() => {
    if (!landed.current) return;
    landed.current = false;
    reset();
  }, [ids]);

  /**
   * The order the held item asks for, placed by its leading edge as the web's
   * lists place theirs, so a tall card still reaches the top.
   */
  function aim(id: string, dy: number): string[] {
    const own = slots.current.get(id);
    if (!own) return [...idsRef.current];
    const rest = idsRef.current.filter((other) => other !== id);
    const others = rest.flatMap((other) => {
      const s = slots.current.get(other);
      return s ? [box(s)] : [];
    });
    const ahead = dropIndex(box({ ...own, y: own.y + dy }), box(own), others, { axis: "y" });
    return [...rest.slice(0, ahead), id, ...rest.slice(ahead)];
  }

  /** Slides the others aside for `order`, by the held item's height and the gap behind it. */
  function makeRoom(id: string, order: string[]) {
    const from = idsRef.current.indexOf(id);
    const to = order.indexOf(id);
    const own = slots.current.get(id);
    const next = slots.current.get(idsRef.current[from + 1] ?? "");
    const prev = slots.current.get(idsRef.current[from - 1] ?? "");
    const step = own ? (next ? next.y - own.y : prev ? own.y - prev.y : own.height) : 0;
    idsRef.current.forEach((other, at) => {
      if (other === id) return;
      const by = to > from && at > from && at <= to ? -step : to < from && at < from && at >= to ? step : 0;
      glide(shift(other), by);
    });
  }

  /** The distance from the held item's own slot to the one `order` gives it. */
  function landing(id: string, order: string[]): number {
    const own = slots.current.get(id);
    const target = slots.current.get(idsRef.current[order.indexOf(id)] ?? "");
    if (!own || !target) return 0;
    // Moving down, the item ends where the last item it passed ends.
    return order.indexOf(id) > idsRef.current.indexOf(id)
      ? target.y + target.height - (own.y + own.height)
      : target.y - own.y;
  }

  function lift(id: string, e: GestureResponderEvent) {
    drag.current = { id, startY: e.nativeEvent.pageY, order: [...idsRef.current], taken: false };
    follow.setValue(0);
    setHeld(id);
    if (ms.layout === 0) grow.setValue(LIFT[intensity]);
    else Animated.spring(grow, { toValue: LIFT[intensity], useNativeDriver: true }).start();
  }

  // The item stays held while it settles, so it lands from under the finger
  // rather than jumping back to its old slot first.
  function drop() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const changed = d.order.join("\n") !== idsRef.current.join("\n");
    if (!changed) makeRoom(d.id, d.order);
    const settle = () => {
      setHeld(null);
      if (changed) {
        landed.current = true;
        onReorderRef.current(d.order);
      } else reset();
    };
    if (ms.layout === 0) return settle();
    Animated.parallel([
      Animated.timing(follow, { toValue: landing(d.id, d.order), duration: ms.layout / 2, useNativeDriver: true }),
      Animated.timing(grow, { toValue: 1, duration: ms.layout / 2, useNativeDriver: true }),
    ]).start(settle);
  }

  const catcher: ViewProps = {
    // Asked on every move before the list or a card, so a lifted item keeps
    // the finger and the list does not scroll under it.
    onMoveShouldSetResponderCapture: () => drag.current !== null,
    onResponderGrant: () => {
      if (drag.current) drag.current.taken = true;
      return true;
    },
    onResponderMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const dy = e.nativeEvent.pageY - d.startY;
      follow.setValue(dy);
      const next = aim(d.id, dy);
      if (next.join("\n") !== d.order.join("\n")) {
        d.order = next;
        makeRoom(d.id, next);
      }
    },
    onResponderTerminationRequest: () => false,
    onResponderRelease: drop,
    // Taken away by the system, as by an incoming call: nothing moves.
    onResponderTerminate: () => {
      if (drag.current) drag.current.order = [...idsRef.current];
      drop();
    },
  };

  // The card's own press ends when the list takes the finger over, which is
  // not a release.
  function release() {
    if (drag.current && !drag.current.taken) drop();
  }

  // One clock runs the tremble of every item, a swing there and back per cycle.
  const cycle = useRef(new Animated.Value(0)).current;
  const { tilt, rise, beat } = TREMBLE[reduced ? "off" : intensity];
  const trembling = held !== null && rise > 0;
  useEffect(() => {
    if (!trembling) return;
    cycle.setValue(0);
    const loop = Animated.loop(
      Animated.timing(cycle, { toValue: 1, duration: 2 * beat, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [trembling, beat, cycle]);
  // As the web's glim-row-wiggle: up and turned one way a quarter in, down
  // and turned the other three quarters in.
  const swings = useMemo(
    () =>
      PHASES.map((early) => {
        const inputRange = Array.from({ length: STEPS + 1 }, (_, at) => at / STEPS);
        const wave = inputRange.map((u) => -Math.sin(2 * Math.PI * (u + early / 2)));
        return {
          rotate: cycle.interpolate({ inputRange, outputRange: wave.map((w) => `${w * tilt}deg`) }),
          translateY: cycle.interpolate({ inputRange, outputRange: wave.map((w) => w * rise) }),
        };
      }),
    [tilt, rise, cycle],
  );

  function style(id: string) {
    if (id === held) return { transform: [{ translateY: follow }, { scale: grow }] };
    if (!trembling) return { transform: [{ translateY: shift(id) }] };
    const place = idsRef.current.indexOf(id) + 1;
    const swing = swings[place % 3 === 0 ? 2 : place % 2 === 0 ? 1 : 0]!;
    return { transform: [{ translateY: shift(id) }, { rotate: swing.rotate }, { translateY: swing.translateY }] };
  }

  // A transform does not move the layout, so a shifted cell still reports
  // its own slot.
  const measure = useRef((id: string, slot: Slot) => slots.current.set(id, slot)).current;
  const cells = useMemo(() => ({ held, measure }), [held, measure]);

  return { held, lift, release, catcher, style, cells };
}

/**
 * The cell a FlatList draws an item in, for `CellRendererComponent`. It keeps
 * its item's place for the drag, and the held one above its neighbours, which
 * Android draws in the order of the cells otherwise.
 */
export function MovingCell<T>({ cellKey, style, onLayout, children, ...rest }: CellRendererProps<T>) {
  const { held, measure } = useContext(Lifted);
  return (
    <View
      {...rest}
      style={[style, cellKey === held ? { zIndex: 1, elevation: 8 } : null]}
      onLayout={(e: LayoutChangeEvent) => {
        onLayout?.(e);
        measure(cellKey, { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height });
      }}
    >
      {children}
    </View>
  );
}
