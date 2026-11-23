import { useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, PermissionsAndroid, StyleSheet, Text, View } from "react-native";
import { api } from "../api";
import { engine, type WifiReading } from "../engine";
import { Field, Refusal } from "../fields";
import { useT } from "../i18n";
import type { MoreStack } from "../nav";
import { space, text } from "../theme";
import { Body, Button, Caption, Empty, Page, Section, useTheme } from "../ui";
import { wifiAccessNote, withWifi, type WifiStep } from "../vpn";
import { errorText } from "../../../web/src/lib/errorText";
import { tunnelName, type VpnState } from "../../../web/src/lib/vpn";

const FINE = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
const COARSE = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
const BACKGROUND = PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION;

/**
 * The wifi networks on which a VPN's jobs connect directly, such as the one at
 * home. The list saves as it changes. Android names the wifi only with
 * location access, which is asked for once someone adds the first one, and
 * until it is given every run goes through the VPN, which the page says.
 */
export function VpnWifi() {
  const route = useRoute<RouteProp<MoreStack, "VpnWifi">>();
  const { t } = useT();
  const { p, corners } = useTheme();
  const { id } = route.params;
  const [vpn, setVpn] = useState<VpnState | null>(null);
  const [reading, setReading] = useState<WifiReading | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");

  const read = useCallback(() => engine.wifi().then(setReading, () => {}), []);

  useEffect(() => {
    api.vpn().then(setVpn, (e) => setError(errorText(t, e)));
    void read();
    // A permission or the location is changed in Android's settings, and the
    // page is shown again on the way back.
    const sub = AppState.addEventListener("change", (s) => s === "active" && void read());
    return () => sub.remove();
  }, [read, t]);

  const tunnel = vpn?.tunnels.find((x) => x.id === id);
  if (!vpn || !tunnel || !reading) return <Empty title={t("vpn.reading")} detail={error || undefined} />;
  const list = tunnel.trustedWifi ?? [];
  const name = tunnelName(tunnel, vpn.providers);

  const save = async (next: string[]) => {
    setError("");
    try {
      setVpn(await api.trustVpnWifi(id, next));
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  // Android shows its own dialog only after ours has said why.
  const askForAccess = (): Promise<boolean> =>
    new Promise((answer) =>
      Alert.alert(
        t("vpn.wifi.askTitle"),
        t("vpn.wifi.ask"),
        [
          { text: t("confirm.cancel"), style: "cancel", onPress: () => answer(false) },
          {
            text: t("vpn.wifi.askGo"),
            onPress: () =>
              void PermissionsAndroid.requestMultiple([FINE, COARSE]).then(
                (got) => answer(got[FINE] === PermissionsAndroid.RESULTS.GRANTED),
                () => answer(false),
              ),
          },
        ],
        { cancelable: true, onDismiss: () => answer(false) },
      ),
    );

  const add = async (wifi: string) => {
    await save(withWifi(list, wifi));
    setTyped("");
    if (reading.access === "none") await askForAccess();
    await read();
  };

  const addCurrent = async () => {
    if (reading.access === "none" && !(await askForAccess())) return;
    const now = await engine.wifi();
    setReading(now);
    if (now.name) await save(withWifi(list, now.name));
  };

  // A permission Android will not ask for again is given on the app's settings page.
  const take = async (step: WifiStep) => {
    if (step.act === "location") {
      await engine.openLocationSettings().catch(() => {});
      return;
    }
    const answer =
      step.act === "grant"
        ? (await PermissionsAndroid.requestMultiple([FINE, COARSE]))[FINE]
        : await PermissionsAndroid.request(BACKGROUND);
    if (answer === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) await engine.openAppSettings().catch(() => {});
    await read();
  };

  const note = wifiAccessNote(reading, list.length > 0, t);
  const current = reading.access !== "none" && reading.name !== "" && !list.includes(reading.name);

  return (
    <Page>
      <Caption>{t("vpn.wifi.hint", { name })}</Caption>
      {/* Kept mounted, since TalkBack announces a live region when its text changes. */}
      <View accessibilityLiveRegion="polite" style={styles.note}>
        {note ? <Body>{note.said}</Body> : null}
        {note?.step ? (
          <Button label={t(note.step.label)} labelKey={note.step.label} onPress={() => void take(note.step!)} />
        ) : null}
      </View>

      <Section title={name}>
        {list.map((wifi) => (
          <View key={wifi} style={[styles.row, { backgroundColor: p.surface2, ...corners.card }]}>
            <Text style={[styles.name, { color: p.text }]} numberOfLines={1}>
              {wifi}
            </Text>
            <Button
              label={t("edit.remove")}
              labelKey="edit.remove"
              glyphOnly
              inWell
              wide={false}
              spoken={`${t("edit.remove")}: ${wifi}`}
              onPress={() => void save(list.filter((x) => x !== wifi))}
            />
          </View>
        ))}
        <Field label={t("vpn.wifi.field")} hint={t("vpn.wifi.fieldHint")} value={typed} onChange={setTyped} />
        {/* The control that goes ahead sits on the right. */}
        <View style={styles.actions}>
          <Button
            label={t("vpn.wifi.addCurrent")}
            labelKey="vpn.wifi.addCurrent"
            disabled={reading.access !== "none" && !current}
            onPress={() => void addCurrent()}
          />
          <Button
            label={t("vpn.wifi.add")}
            labelKey="vpn.wifi.add"
            tone="accent"
            disabled={typed.trim() === "" || list.includes(typed.trim())}
            onPress={() => void add(typed)}
          />
        </View>
      </Section>

      <View accessibilityLiveRegion="polite">{error ? <Refusal text={error} /> : null}</View>
    </Page>
  );
}

const styles = StyleSheet.create({
  note: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs, paddingHorizontal: space.md },
  name: { flex: 1, minWidth: 0, fontSize: text.body },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm },
});
