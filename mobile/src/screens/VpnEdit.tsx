import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, EngineError } from "../api";
import { engine } from "../engine";
import { Field, Refusal } from "../fields";
import { VpnMark } from "../glyphs";
import { useT } from "../i18n";
import type { MoreStack, Nav } from "../nav";
import { space } from "../theme";
import { Body, Button, Caption, Empty, Page, Section, Title, useTheme } from "../ui";
import { errorText } from "../../../web/src/lib/errorText";
import {
  tunnelName,
  VPN_FIELDS,
  VPN_NOTES,
  vpnFieldHint,
  vpnFilled,
  vpnKeepHint,
  vpnRefusal,
  type VpnField,
  type VpnState,
} from "../../../web/src/lib/vpn";

type Values = Partial<Record<VpnField, string>>;

/**
 * A provider's login, for a new VPN or one set up. A stored login never comes
 * back, so the fields of one set up start empty and an empty field keeps what
 * is stored. Nothing connects until a job that names it runs.
 */
export function VpnEdit() {
  const route = useRoute<RouteProp<MoreStack, "VpnEdit">>();
  const nav = useNavigation<Nav<MoreStack>>();
  const { t } = useT();
  const { p, scheme } = useTheme();
  const { provider: id, id: editing } = route.params;
  const [vpn, setVpn] = useState<VpnState | null>(null);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Values>({});
  const [missing, setMissing] = useState<VpnField | "">("");
  const [refusal, setRefusal] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.vpn().then(setVpn, (e) => setError(errorText(t, e)));
  }, [t]);

  const provider = vpn?.providers.find((x) => x.id === id);
  const tunnel = editing ? vpn?.tunnels.find((x) => x.id === editing) : undefined;
  const name = tunnel && vpn ? tunnelName(tunnel, vpn.providers) : (provider?.name ?? id);

  useEffect(() => {
    nav.setOptions({ title: name });
  }, [nav, name]);

  if (!vpn || !provider) return <Empty title={t("vpn.reading")} detail={error || undefined} />;

  const set = (f: VpnField, v: string) => {
    setValues((was) => ({ ...was, [f]: v }));
    if (missing === f) setMissing("");
    setRefusal("");
  };

  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        await api.saveVpn(editing, values);
        nav.goBack();
      } else {
        await api.addVpn(id, values);
        nav.popTo("SettingsHome");
      }
    } catch (e) {
      const read = e instanceof EngineError ? vpnRefusal(t, e, name) : null;
      if (read && "missing" in read) setMissing(read.missing);
      else setRefusal(read?.said ?? errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  // Android's picker reads any file as text, the same one a backup comes in through.
  const chooseFile = () =>
    engine.pickBackup().then(
      (file) => file && set("config", file.text),
      (e) => setRefusal(errorText(t, e)),
    );

  const note = VPN_NOTES[provider.id];

  return (
    <Page>
      <View style={styles.head}>
        <VpnMark provider={provider.id} width={44} height={36} scheme={scheme} lit={false} color={p.textSub} />
        <View style={styles.headText}>
          <Title>{name}</Title>
        </View>
      </View>
      <Caption>{t("vpn.formHint", { name })}</Caption>
      {note ? <Body>{t(note, { name })}</Body> : null}
      {tunnel ? <Body muted>{vpnKeepHint(t, provider.fields)}</Body> : null}

      <Section title={provider.name}>
        {provider.fields.map((f) => (
          <View key={f} style={styles.field}>
            <Field
              label={t(VPN_FIELDS[f].label)}
              hint={vpnFieldHint(t, provider.id, f, name)}
              value={values[f] ?? (f === "location" ? (tunnel?.place ?? "") : "")}
              onChange={(v) => set(f, v)}
              secret={VPN_FIELDS[f].secret}
              multiline={f === "config"}
              placeholder={f !== "config" ? undefined : tunnel ? t("vpn.field.configSaved") : CONFIG_EXAMPLE}
              hidePlaceholderOnFocus={f === "config"}
              error={missing === f ? t("vpn.field.missing") : undefined}
            />
            {f === "config" ? (
              <Button
                label={t("vpn.field.chooseFile")}
                labelKey="vpn.field.chooseFile"
                glyph="IconFolder"
                onPress={() => void chooseFile()}
              />
            ) : null}
          </View>
        ))}
      </Section>

      {/* Kept mounted, since TalkBack announces a live region when its text changes. */}
      <View accessibilityLiveRegion="polite">{refusal ? <Refusal text={refusal} /> : null}</View>

      {/* The control that goes ahead sits on the right. */}
      <View style={styles.actions}>
        {editing ? (
          <Button label={t("vpn.cancel")} labelKey="vpn.cancel" onPress={() => nav.goBack()} />
        ) : (
          <Button label={t("preview.back")} labelKey="preview.back" onPress={() => nav.goBack()} />
        )}
        <Button
          label={t("edit.save")}
          labelKey="edit.save"
          tone="accent"
          busy={busy}
          disabled={!vpnFilled(provider.fields, values, Boolean(tunnel))}
          onPress={() => void save()}
        />
      </View>
    </Page>
  );
}

const CONFIG_EXAMPLE = "[Interface]\nPrivateKey = …\nAddress = 10.0.0.2/32\n\n[Peer]\nPublicKey = …\nEndpoint = vpn.example.net:51820";

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  headText: { flex: 1 },
  field: { gap: space.sm },
  actions: { flexDirection: "row", gap: space.sm },
});
