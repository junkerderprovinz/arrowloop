import type { TileMark } from "@glimstone/core";
import { VPN_PROVIDERS as CATALOG } from "@glimstone/core/vpnProviders";
import type { Translate } from "../../web/src/lib/i18n.data.ts";
import { matchesQuery } from "../../web/src/lib/fold.ts";
import {
  CUSTOM,
  tunnelName,
  VPN_STATUS,
  vpnFailure,
  type VpnState,
  type VpnTunnelState,
} from "../../web/src/lib/vpn.ts";

// The phone's side of the VPN settings. The tables and the words are
// web/src/lib/vpn.ts, which the browser reads too; the marks are GlimStone's.

const MARKS = new Map<string, TileMark>(CATALOG.entries.flatMap((e) => (e.mark ? [[e.id, e.mark] as const] : [])));
const TERMS = new Map<string, readonly string[]>(CATALOG.entries.flatMap((e) => (e.terms ? [[e.id, e.terms] as const] : [])));

/** A provider's mark, or none for a provider the engine knows and this catalog does not yet. */
export function vpnMark(id: string): TileMark | undefined {
  return MARKS.get(id);
}

/** Whether a provider's mark is its name written out, which takes a name's place rather than a symbol's. */
export function vpnWordmark(id: string): boolean {
  return MARKS.get(id)?.wordmark === true;
}

/** How wide a wordmark stands at a height, by its own aspect, held to `most`. */
export function wordmarkWidth(mark: TileMark, height: number, most: number): number {
  const [, , w = height, h = height] = /viewBox="([^"]+)"/.exec(mark.svg)?.[1]?.split(/[\s,]+/).map(Number) ?? [];
  return Math.min(most, (height * w) / h);
}

/**
 * A mark as react-native-svg can draw it. GlimStone paints a lit tile through
 * the --mark-ink and --mark-cut variables and a mark's two themes through
 * light-dark(), and an SVG parser resolves neither, so both are written in.
 */
export function markXml(mark: TileMark, scheme: "light" | "dark", lit: boolean): string {
  const svg = lit ? (mark.hover ?? mark.svg) : mark.svg;
  const themed = replaceCalls(svg, "light-dark", ([light = "", dark = ""]) => (scheme === "light" ? light : dark));
  return replaceCalls(themed, "var", ([name, own = ""]) => {
    if (!lit) return own;
    if (name === "--mark-ink") return mark.ink ?? own;
    return mark.tile ?? own;
  });
}

/** Every call of a CSS function in text, innermost first, replaced by what `by` makes of its arguments. */
function replaceCalls(text: string, fn: string, by: (args: string[]) => string): string {
  let out = text;
  for (let at = out.lastIndexOf(`${fn}(`); at >= 0; at = out.lastIndexOf(`${fn}(`)) {
    const args: string[] = [];
    let from = at + fn.length + 1;
    let depth = 0;
    let end = from;
    for (; end < out.length; end++) {
      const c = out[end];
      if (c === "(") depth++;
      else if (c === ")" && depth-- === 0) break;
      else if (c === "," && depth === 0) {
        args.push(out.slice(from, end).trim());
        from = end + 1;
      }
    }
    args.push(out.slice(from, end).trim());
    out = out.slice(0, at) + by(args) + out.slice(end + 1);
  }
  return out;
}

/** One tile of the picker. */
export interface PickTile {
  id: string;
  name: string;
  /** "Set up" under a provider that already has a VPN. */
  sub?: string;
  hint?: string;
}

/**
 * The picker's tiles under the search, in the engine's order: the providers,
 * then a WireGuard server of one's own. A group nothing matches is left out.
 */
export function pickGroups(vpn: VpnState, query: string, t: Translate): { title: string; tiles: PickTile[] }[] {
  const tile = (id: string, name: string): PickTile => ({
    id,
    name,
    sub: vpn.tunnels.some((x) => x.provider === id) ? t("vpn.saved") : undefined,
    hint: id === CUSTOM ? t("vpn.customHint") : undefined,
  });
  const found = vpn.providers
    .filter((p) => matchesQuery(query, [p.name, p.id, ...(TERMS.get(p.id) ?? [])]))
    .map((p) => tile(p.id, p.name));
  return [
    { title: t("vpn.pickProviders"), tiles: found.filter((x) => x.id !== CUSTOM) },
    { title: t("vpn.pickOwn"), tiles: found.filter((x) => x.id === CUSTOM) },
  ].filter((g) => g.tiles.length > 0);
}

/**
 * Whether a job shows its choice of VPN: on an engine that has VPNs, for a
 * job with a side across the network. A job that names one where it does
 * nothing keeps the choice, so it can be set to none.
 */
export function vpnChoiceShown(offered: boolean, value: string, network: boolean): boolean {
  return value !== "" || (offered && network);
}

/** The options of a job's choice: none first, then every VPN by its provider and place. */
export function vpnOptions(vpn: VpnState | null, t: Translate): { value: string; label: string }[] {
  return [
    { value: "", label: t("edit.vpnOff") },
    ...(vpn ? vpn.tunnels.map((x) => ({ value: x.id, label: tunnelName(x, vpn.providers) })) : []),
  ];
}

/** What the last test of a VPN found. */
export interface Verdict {
  ok: boolean;
  said?: string;
  detail?: string;
}

/** A test's answer as a verdict: the address traffic left at, or why the tunnel did not come up. */
export function testVerdict(
  answer: { ok: boolean; reason?: string; state: VpnState },
  id: string,
  name: string,
  t: Translate,
): Verdict {
  const st = answer.state.tunnels.find((x) => x.id === id);
  if (answer.ok) return { ok: true, said: st?.exitIp ? t("vpn.exit", { address: st.exitIp }) : undefined };
  return { ok: false, ...vpnFailure(t, { errorCode: st?.errorCode, error: answer.reason ?? st?.error }, name) };
}

/**
 * The line under a VPN's name: what its last test found, else why it failed
 * last, else how it stands and for which runs.
 */
export function tunnelLine(
  tunnel: VpnTunnelState,
  verdict: Verdict | null,
  name: string,
  t: Translate,
): { said: string; failed: boolean } {
  if (verdict?.said) return { said: verdict.said, failed: !verdict.ok };
  if (tunnel.status === "failed" && verdict?.ok !== false) return { said: vpnFailure(t, tunnel, name).said, failed: true };
  const carrying = tunnel.status === "connected" && tunnel.jobs.length > 0;
  return {
    said: carrying ? t("vpn.carrying", { jobs: tunnel.jobs.join(", ") }) : t(VPN_STATUS[tunnel.status].word),
    failed: false,
  };
}

/** The jobs that name a VPN, by their names. */
export function jobsThrough(jobs: readonly { name: string; vpn?: string | true }[], id: string): string[] {
  return jobs.filter((j) => j.vpn === id).map((j) => j.name);
}
