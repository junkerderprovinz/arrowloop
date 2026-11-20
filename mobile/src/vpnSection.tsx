import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { api } from "./api";
import { VpnMark, vpnTile } from "./glyphs";
import { useT } from "./i18n";
import type { MoreStack, Nav } from "./nav";
import { space, text } from "./theme";
import { Badge, Body, Button, InfoBubble, Section, useTheme } from "./ui";
import { jobsThrough, testVerdict, tunnelLine, type Verdict } from "./vpn";
import { errorText } from "../../web/src/lib/errorText";
import { tunnelName, VPN_STATUS, type VpnState, type VpnTunnelState } from "../../web/src/lib/vpn";

/**
 * The VPNs jobs can go through, each as a row with how its tunnel stands, the
 * jobs that name it and its test, edit and remove. The tunnels come and go
 * with the runs, so the rows are read again while the page shows. A tunnel is
 * only up while such a job runs, so "off" is its resting state and no fault.
 */
export function IntegrationsSection({ hue }: { hue: number }) {
  const nav = useNavigation<Nav<MoreStack>>();
  const { t } = useT();
  const [vpn, setVpn] = useState<VpnState | null>(null);
  const [jobs, setJobs] = useState<{ name: string; vpn?: string | true }[]>([]);
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      const read = () =>
        api.vpn().then(
          (next) => {
            setVpn(next);
            setError("");
          },
          (e) => setError(errorText(t, e)),
        );
      void read();
      api.config().then(
        (c) => setJobs(c.jobs),
        () => {},
      );
      const every = setInterval(read, 5000);
      return () => clearInterval(every);
    }, [t]),
  );

  const remove = (tunnel: VpnTunnelState, name: string) =>
    Alert.alert(t("vpn.removeAsk", { name }), t("vpn.removeStakes"), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("edit.remove"),
        // Not "destructive": GlimStone paints no delete red, dialogs included.
        onPress: () => void api.forgetVpn(tunnel.id).then(setVpn, (e) => setError(errorText(t, e))),
      },
    ]);

  return (
    <Section title={t("settings.integrations")} hint={t("vpn.hint")} hue={hue}>
      {!vpn ? <Body>{error || t("vpn.reading")}</Body> : null}
      {vpn?.tunnels.length === 0 ? <Body>{t("vpn.none")}</Body> : null}
      {vpn?.tunnels.map((tunnel) => {
        const name = tunnelName(tunnel, vpn.providers);
        return (
          <TunnelRow
            key={tunnel.id}
            tunnel={tunnel}
            name={name}
            jobs={jobsThrough(jobs, tunnel.id)}
            onState={setVpn}
            onEdit={() => nav.navigate("VpnEdit", { provider: tunnel.provider, id: tunnel.id })}
            onRemove={() => remove(tunnel, name)}
          />
        );
      })}
      {vpn && error ? <Body>{error}</Body> : null}
      <Button label={t("vpn.setUp")} labelKey="vpn.setUp" onPress={() => nav.navigate("VpnPick")} />
    </Section>
  );
}

/**
 * One VPN as GlimStone's connection row: its mark lit on its brand's tile the
 * row's whole height, its name and how it stands, the jobs that name it, and
 * its buttons, which show their glyphs alone on a phone so they keep to one
 * line.
 */
function TunnelRow({
  tunnel,
  name,
  jobs,
  onState,
  onEdit,
  onRemove,
}: {
  tunnel: VpnTunnelState;
  name: string;
  jobs: string[];
  onState: (next: VpnState) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const { p, corners, scheme, accent, accentContrast } = useTheme();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [testing, setTesting] = useState(false);
  // A counter, so every failed test shakes the button.
  const [refused, setRefused] = useState(0);
  const status = VPN_STATUS[tunnel.status];
  const tile = vpnTile(tunnel.provider) ?? { color: accent, ink: accentContrast };
  const line = tunnelLine(tunnel, verdict, name, t);

  const test = async () => {
    setTesting(true);
    setVerdict(null);
    try {
      const answer = await api.testVpn(tunnel.id);
      onState(answer.state);
      const found = testVerdict(answer, tunnel.id, name, t);
      setVerdict(found);
      if (!found.ok) setRefused((n) => n + 1);
    } catch (e) {
      setVerdict({ ok: false, said: errorText(t, e) });
      setRefused((n) => n + 1);
    } finally {
      setTesting(false);
    }
  };

  return (
    <View style={[styles.row, { backgroundColor: p.surface2, ...corners.card }]}>
      <View style={[styles.tile, { backgroundColor: tile.color }]}>
        <VpnMark provider={tunnel.provider} width={MARK} height={MARK} scheme={scheme} lit color={tile.ink} />
      </View>
      <View style={styles.main}>
        <View style={styles.head}>
          <Text style={[styles.name, { color: p.text }]} numberOfLines={1}>
            {name}
          </Text>
          {status.badge ? <Badge label={t(status.word)} tone={status.badge} /> : null}
        </View>
        {/* Kept mounted, since TalkBack announces a live region when its text changes. */}
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.status, { color: line.failed ? p.failInk : p.textSub }]}>{line.said}</Text>
        </View>
        <View style={styles.jobs}>
          <Text style={[styles.jobsLabel, { color: p.textMuted }]}>{t("vpn.jobs")}</Text>
          <InfoBubble tip={t("vpn.jobsHint")} />
          <Text style={[styles.jobsNames, { color: p.textSub }]} numberOfLines={1}>
            {jobs.length > 0 ? jobs.join(", ") : t("vpn.jobsNone")}
          </Text>
        </View>
        <View style={styles.actions}>
          <Button
            label={t("vpn.test")}
            labelKey="vpn.test"
            glyphOnly
            wide={false}
            glyph={testing || !verdict ? undefined : verdict.ok ? "IconCheck" : "IconClose"}
            tone={testing || !verdict ? "neutral" : verdict.ok ? "ok" : "fail"}
            busy={testing}
            shake={refused}
            spoken={verdict?.said ? `${t("vpn.test")}: ${verdict.said}` : undefined}
            onPress={() => void test()}
          />
          <Button label={t("vpn.edit")} labelKey="vpn.edit" glyphOnly wide={false} onPress={onEdit} />
          <Button label={t("edit.remove")} labelKey="edit.remove" glyphOnly wide={false} onPress={onRemove} />
        </View>
      </View>
    </View>
  );
}

/** GlimStone's mark on a narrow row, 2rem. */
const MARK = 32;

const styles = StyleSheet.create({
  row: { flexDirection: "row", overflow: "hidden" },
  // 4.5rem, as GlimStone's tile on a narrow row.
  tile: { width: 72, alignItems: "center", justifyContent: "center" },
  main: { flex: 1, minWidth: 0, gap: space.xs, padding: space.md },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  name: { flexGrow: 1, flexShrink: 1, fontSize: text.body, fontWeight: "500" },
  status: { fontSize: text.meta },
  jobs: { flexDirection: "row", alignItems: "center", gap: space.xs },
  jobsLabel: { fontSize: text.meta, flexShrink: 0 },
  jobsNames: { flex: 1, minWidth: 0, fontSize: text.meta },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm, marginTop: space.xs },
});
