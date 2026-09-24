import { useEffect, useSyncExternalStore } from "react";

import { DISCO_TICK_MS } from "../../web/src/lib/disco";
import { buildLoop, colourAt } from "../../web/src/lib/discoLoop";
import { useMotion } from "./motion";
import { useAppearance } from "./settings";
import { RAINBOW } from "./theme";

// The phone's disco walks the same loop as the web's. A phone has no root
// variables for the colours to live in, so the walked palette sits in this
// store and useTheme reads it. Ten frames a second is smooth enough for a
// colour that takes 2.4 seconds to arrive and cheap enough to re-render a
// screen of hued controls.

const FRAME_MS = 100;

let walked: string[] | null = null;
const listeners = new Set<() => void>();

function publish(next: string[] | null): void {
  if (next?.join() === walked?.join()) return;
  walked = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The walked colours by position, rotation included, or null at rest. */
export function useWalkedPalette(): string[] | null {
  return useSyncExternalStore(subscribe, () => walked);
}

/**
 * Runs the walk while disco and the rainbow are both on. Mounted once, at the
 * app's root. With the motion off, or Android asking for less, it steps one
 * colour every 2.4 seconds instead of gliding, and only a step re-renders.
 */
export function useDiscoWalk(): void {
  const a = useAppearance();
  const { intensity } = useMotion();
  const on = a.disco && a.rainbow;
  const palette = a.palette.length ? a.palette : RAINBOW;
  const key = palette.join();
  const start = a.rainbowRotate ? a.rainbowSeed : 0;
  const steps = intensity === "off";

  useEffect(() => {
    if (!on) {
      publish(null);
      return;
    }
    const colours = key.split(",");
    const loop = buildLoop(colours);
    const n = colours.length;
    const began = Date.now();
    const tick = () => {
      const travelled = ((Date.now() - began) / (DISCO_TICK_MS * n)) % 1;
      publish(
        colours.map((_, i) =>
          steps
            ? colours[(i + start + Math.floor(travelled * n)) % n]!
            : colourAt(loop, loop.at[(i + start) % n]! + travelled * loop.at[n]!),
        ),
      );
    };
    tick();
    const id = setInterval(tick, steps ? DISCO_TICK_MS / 4 : FRAME_MS);
    return () => {
      clearInterval(id);
      publish(null);
    };
  }, [on, key, start, steps]);
}
