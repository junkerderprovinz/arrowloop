import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../../web/src/lib/i18n.data.ts";
import { VPN_PROVIDERS, vpnKeepHint, type VpnState, type VpnTunnelState } from "../../web/src/lib/vpn.ts";
import {
  jobsThrough,
  markXml,
  pickGroups,
  testVerdict,
  tunnelLine,
  directOn,
  vpnChoiceShown,
  vpnMark,
  vpnOptions,
  vpnWordmark,
  wifiAccessNote,
  withWifi,
  wordmarkWidth,
} from "./vpn.ts";

const t = (key: string, vars?: Record<string, string | number>) =>
  ((en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));

const providers = VPN_PROVIDERS.map((p) => ({ id: p.id, name: p.name, fields: [...p.fields] }));
const home: VpnTunnelState = { id: "custom", provider: "custom", place: "vpn.example.net", status: "down", jobs: [] };
const state = (tunnels: VpnTunnelState[] = []): VpnState => ({ tunnels, providers });

test("every provider the engine offers wears a GlimStone mark", () => {
  for (const p of providers) assert.ok(vpnMark(p.id), p.id);
});

test("a mark at rest keeps its own colours and both themes resolve", () => {
  const mark = { svg: '<path style="fill:var(--mark-ink, light-dark(#111111, #eeeeee))"/>', tile: "#ff0000", ink: "#ffffff" };
  assert.equal(markXml(mark, "light", false), '<path style="fill:#111111"/>');
  assert.equal(markXml(mark, "dark", false), '<path style="fill:#eeeeee"/>');
});

test("a lit mark takes its tile's ink, and its cut-outs the tile's colour", () => {
  const mark = {
    svg: '<path style="fill:var(--mark-ink, #26c)"/><path style="fill:var(--mark-cut, url(#glim-a))"/>',
    tile: "#2266cc",
    ink: "#ffffff",
  };
  assert.equal(markXml(mark, "dark", true), '<path style="fill:#ffffff"/><path style="fill:#2266cc"/>');
});

test("a lit mark draws the drawing GlimStone keeps for its tile", () => {
  const mark = { svg: "<g>rest</g>", hover: "<g>lit</g>", tile: "#000000", ink: "#ffffff" };
  assert.equal(markXml(mark, "light", true), "<g>lit</g>");
});

test("a gradient stop nested in two themes resolves to one colour", () => {
  const mark = { svg: '<stop style="stop-color:light-dark(#4942ff, light-dark(#4942ff, #c9c7ff))"/>' };
  assert.equal(markXml(mark, "dark", false), '<stop style="stop-color:#c9c7ff"/>');
});

test("no real mark keeps a variable or a theme function the phone cannot read", () => {
  for (const p of providers) {
    const mark = vpnMark(p.id)!;
    for (const scheme of ["light", "dark"] as const) {
      for (const lit of [false, true]) {
        assert.doesNotMatch(markXml(mark, scheme, lit), /var\(|light-dark\(/, `${p.id} ${scheme} ${lit}`);
      }
    }
  }
});

test("the picker puts the providers first and a server of one's own after them", () => {
  const groups = pickGroups(state(), "", t);
  assert.deepEqual(
    groups.map((g) => g.title),
    ["Providers", "Your own server"],
  );
  assert.equal(groups[0]!.tiles[0]!.name, "NordVPN");
  assert.deepEqual(groups[1]!.tiles.map((x) => x.id), ["custom"]);
  assert.equal(groups[1]!.tiles[0]!.hint, en["vpn.customHint"]);
});

test("the search finds a provider by a word it is also known by", () => {
  const groups = pickGroups(state(), "nordlynx", t);
  assert.deepEqual(groups.flatMap((g) => g.tiles.map((x) => x.id)), ["nordvpn"]);
});

test("a search that matches nothing leaves no group", () => {
  assert.deepEqual(pickGroups(state(), "no such provider", t), []);
});

test("a provider that already has a VPN says it is set up", () => {
  const own = pickGroups(state([home]), "wireguard", t)[0]!.tiles[0]!;
  assert.equal(own.sub, "Set up");
});

test("a job choosing its VPN sees none first, then each VPN by provider and place", () => {
  assert.deepEqual(vpnOptions(state([home]), t), [
    { value: "", label: "No VPN" },
    { value: "custom", label: "WireGuard (vpn.example.net)" },
  ]);
});

test("only a job with a side across the network is offered a VPN", () => {
  assert.equal(vpnChoiceShown(true, "", true), true);
  assert.equal(vpnChoiceShown(true, "", false), false);
  assert.equal(vpnChoiceShown(false, "", true), false);
});

test("a job that names a VPN keeps the choice so it can be set to none", () => {
  assert.equal(vpnChoiceShown(false, "custom", false), true);
});

test("a test that fails to connect says why in the reader's words", () => {
  const failed = { ...home, status: "failed" as const, errorCode: "vpn-timeout", error: "handshake did not complete" };
  const verdict = testVerdict({ ok: false, reason: "handshake did not complete", state: state([failed]) }, "custom", "WireGuard", t);
  assert.deepEqual(verdict, {
    ok: false,
    said: en["vpn.error.timeout"],
    detail: "handshake did not complete",
  });
  assert.deepEqual(tunnelLine(failed, verdict, "WireGuard", t), { said: en["vpn.error.timeout"], failed: true });
});

test("a VPN the device does not let start says the device's reason, not the configuration's", () => {
  const failed = { ...home, status: "failed" as const, errorCode: "vpn-start-failed", error: "permission denied" };
  const verdict = testVerdict({ ok: false, reason: "permission denied", state: state([failed]) }, "custom", "WireGuard", t);
  assert.equal(verdict.said, "WireGuard could not start on this device: permission denied");
  assert.equal(tunnelLine(failed, null, "WireGuard", t).said, "WireGuard could not start on this device: permission denied");
});

test("a failure without a known code shows the engine's own words", () => {
  const verdict = testVerdict({ ok: false, reason: "dial udp: no route", state: state([home]) }, "custom", "WireGuard", t);
  assert.deepEqual(verdict, { ok: false, said: "dial udp: no route" });
});

test("a test that connects names the address traffic left at", () => {
  const up = { ...home, exitIp: "203.0.113.7" };
  assert.deepEqual(testVerdict({ ok: true, state: state([up]) }, "custom", "WireGuard", t), {
    ok: true,
    said: "Traffic leaves at 203.0.113.7.",
  });
});

test("a VPN at rest says it is off until a job needs it", () => {
  assert.deepEqual(tunnelLine(home, null, "WireGuard", t), { said: "Off until a job needs it", failed: false });
});

test("a connected VPN names the jobs it carries", () => {
  const carrying = { ...home, status: "connected" as const, jobs: ["Photos"] };
  assert.equal(tunnelLine(carrying, null, "WireGuard", t).said, "Connected for Photos");
});

test("the jobs of a VPN are those that name it", () => {
  const jobs = [{ name: "Photos", vpn: "custom" }, { name: "Music" }, { name: "Old", vpn: true as const }];
  assert.deepEqual(jobsThrough(jobs, "custom"), ["Photos"]);
});

test("a provider whose mark spells its name is known as a wordmark", () => {
  assert.equal(vpnWordmark("astrill"), true);
  assert.equal(vpnWordmark("nordvpn"), false);
});

test("a wordmark keeps its aspect at a height and is held to the most it may take", () => {
  const mark = { svg: '<svg viewBox="0 0 100 20"></svg>' };
  assert.equal(wordmarkWidth(mark, 10, 112), 50);
  assert.equal(wordmarkWidth(mark, 26, 112), 112);
});

test("a VPN set up from a .conf says its configuration stays until another replaces it", () => {
  assert.equal(vpnKeepHint(t, ["config"]), en["vpn.keepSavedConfig"]);
  assert.equal(vpnKeepHint(t, ["accountNumber", "location"]), en["vpn.keepSaved"]);
});

test("a wifi joins the list once, trimmed, after those there are", () => {
  assert.deepEqual(withWifi(["Home"], "  Office "), ["Home", "Office"]);
  assert.deepEqual(withWifi(["Home"], "Home"), ["Home"]);
  assert.deepEqual(withWifi(["Home"], "   "), ["Home"]);
  // A name differs by its case, as the phone reports it.
  assert.deepEqual(withWifi(["Home"], "home"), ["Home", "home"]);
});

test("the list says what keeps the phone from naming the wifi, and the step that helps", () => {
  const reading = { name: "", access: "always", locationOn: true } as const;
  assert.equal(wifiAccessNote({ ...reading, access: "none" }, false, t), null, "nothing to say before a wifi is listed");
  assert.deepEqual(wifiAccessNote({ ...reading, access: "none" }, true, t), {
    said: en["vpn.wifi.noAccess"],
    step: { label: "vpn.wifi.grant", act: "grant" },
  });
  assert.deepEqual(wifiAccessNote({ ...reading, locationOn: false }, true, t), {
    said: en["vpn.wifi.locationOff"],
    step: { label: "vpn.wifi.locationOpen", act: "location" },
  });
  assert.deepEqual(wifiAccessNote({ ...reading, access: "foreground" }, true, t), {
    said: en["vpn.wifi.foreground"],
    step: { label: "vpn.wifi.always", act: "always" },
  });
  assert.deepEqual(wifiAccessNote({ ...reading, name: "Home" }, true, t), { said: t("vpn.wifi.now", { wifi: "Home" }) });
  assert.deepEqual(wifiAccessNote(reading, true, t), { said: en["vpn.wifi.nowNone"] });
});

test("a VPN row names the wifi networks its jobs connect directly on", () => {
  assert.equal(directOn({ ...home, trustedWifi: ["Home", "Office"] }, t), t("vpn.wifi.direct", { names: "Home, Office" }));
  assert.equal(directOn(home, t), "");
  assert.equal(directOn({ ...home, trustedWifi: [] }, t), "");
});
