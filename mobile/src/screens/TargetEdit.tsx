import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { api, type Backend, type Provider, type Remote } from "../api";
import { Field } from "../fields";
import { useT, type T } from "../i18n";
import type { TranslationKey } from "../i18n";
import type { Nav, TargetsStack } from "../nav";
import { optionHint } from "../../../web/src/lib/optionHint";
import { suggestTargetName } from "../../../web/src/lib/targetName";
import { space } from "../theme";
import { Body, Button, Caption, Empty, Page, Section, Title } from "../ui";

/**
 * The target form. Its fields are the options rclone marks required or
 * essential for the backend; the provider's preset (such as the S3 provider
 * name) is applied underneath and not shown.
 */
export function TargetEdit() {
  const route = useRoute<RouteProp<TargetsStack, "TargetEdit">>();
  const nav = useNavigation<Nav<TargetsStack>>();
  const { t } = useT();
  const editing = route.params?.name;
  const providerId = route.params?.provider;

  const [providers, setProviders] = useState<Provider[]>([]);
  const [backends, setBackends] = useState<Backend[]>([]);
  const [existing, setExisting] = useState<Remote | null>(null);
  const [name, setName] = useState(editing ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.storage().then(
      (s) => {
        setProviders(s.providers);
        // A new target's name is prefilled from the provider, numbered when
        // taken. Only an empty field is filled, so typing during the request
        // survives.
        const picked = s.providers.find((x) => x.id === providerId);
        if (!editing && picked) {
          setName((old) => (old ? old : suggestTargetName(picked.name, s.remotes.map((r) => r.name))));
        }
        // Backends no provider entry covers still have to be editable.
        setBackends([...s.backends, ...s.unlisted]);
        const found = s.remotes.find((r) => r.name === editing) ?? null;
        setExisting(found);
        if (found) {
          const start: Record<string, string> = {};
          for (const setting of found.settings) {
            // Secrets come back withheld; an untouched empty field keeps them.
            if (!setting.secret) start[setting.key] = setting.value;
          }
          setValues(start);
        }
      },
      (e: Error) => setError(e.message),
    );
  }, [editing, providerId]);

  /**
   * The product this target is: the one just picked, else the one the engine
   * resolved for a saved target (internal/remotes/identify.go), else a guess
   * from the backend for a target written by hand.
   */
  const provider = useMemo(
    () =>
      providers.find((x) => x.id === providerId) ??
      providers.find((x) => x.id === existing?.provider) ??
      providers.find((x) => x.backend === existing?.type) ??
      null,
    [providers, providerId, existing],
  );

  const backendName = provider?.backend ?? existing?.type ?? "";
  const backend = useMemo(
    () => backends.find((b) => b.name === backendName) ?? null,
    [backends, backendName],
  );

  // Required options first, then the ones rclone calls essential.
  const options = useMemo(() => {
    const all = backend?.options ?? [];
    const preset = provider?.preset ?? {};
    return all
      .filter((o) => (o.required || o.essential) && !(o.name in preset))
      .sort((a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)));
  }, [backend, provider]);

  // The connection test's state. These hooks have to stay above the early
  // return, or the hook count changes between renders.
  const [trying, setTrying] = useState(false);
  const [tried, setTried] = useState<{ ok: boolean; reason?: string } | null>(null);
  // A counter rather than a flag, so every failed attempt shakes the button.
  const [refused, setRefused] = useState(0);

  if (!backendName) {
    return <Empty title={t("targets.addStorage")} detail={error || t("history.working")} />;
  }

  const answered = (answer: { ok: boolean; reason?: string }) => {
    setTried(answer);
    if (!answer.ok) setRefused((n) => n + 1);
  };

  const tryIt = async () => {
    setTrying(true);
    setTried(null);
    try {
      answered(
        await api.tryRemote(
          backendName,
          { ...(provider?.preset ?? {}), ...prune(values) },
          // Lets the engine fill in the withheld secrets of a saved target.
          editing,
        ),
      );
    } catch (e) {
      answered({ ok: false, reason: (e as Error).message });
    } finally {
      setTrying(false);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setError(t("targets.remoteNameHint"));
      return;
    }
    setSaving(true);
    try {
      await api.saveRemote(name.trim(), {
        type: backendName,
        settings: { ...(provider?.preset ?? {}), ...prune(values) },
      });
      nav.popToTop();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <Title>{provider?.name ?? backendName}</Title>
      {provider?.hint ? <Caption>{provider.hint}</Caption> : null}

      <Section title={t("targets.remoteName")} hint={t("targets.remoteNameHint")}>
        <Field
          label={t("targets.remoteName")}
          value={name}
          onChange={setName}
          placeholder={provider?.id ?? backendName}
        />
      </Section>

      {provider?.auth === "oauth" && provider.authUrl ? (
        // An OAuth backend needs a token from a browser round trip.
        <Section
          title={t("targets.tokenNeeded", { backend: provider.name })}
          hint={t("targets.tokenHowTo", { backend: provider.backend })}
        >
          <Button
            label={t("help.authOauth")}
            labelKey="help.authOauth"
            onPress={() => Linking.openURL(provider.authUrl!)}
          />
        </Section>
      ) : null}

      <Section title={t("targets.access")}>
        {options.map((option) => (
          <Field
            key={option.name}
            label={label(option.name, t)}
            hint={optionHint(option, t, provider)}
            secret={option.secret}
            value={values[option.name] ?? ""}
            onChange={(next) => setValues((old) => ({ ...old, [option.name]: next }))}
            placeholder={
              option.secret && existing?.settings.some((s) => s.key === option.name && s.secret)
                ? t("targets.secretSet")
                : undefined
            }
          />
        ))}
        {options.length === 0 ? <Body>{t("phone.noSettings")}</Body> : null}
      </Section>

      {error ? <Body>{error}</Body> : null}

      {/* Only the reason: the button itself shows the verdict. */}
      {tried && !tried.ok && tried.reason ? <Body>{tried.reason}</Body> : null}

      {/* The test runs before anything is saved. The button's colour, word,
          glyph and shake all show the result of the last attempt, so colour is
          never the only signal. */}
      <Button
        label={
          trying
            ? t("targets.checking")
            : !tried
              ? t("targets.check")
              : tried.ok
                ? t("targets.checkOk")
                : t("targets.checkFailed")
        }
        labelKey="targets.check"
        // Named outright, since the key-to-glyph rule would give every state
        // the magnifier.
        glyph={!tried || trying ? undefined : tried.ok ? "IconConfirm" : "IconCancel"}
        busy={trying}
        tone={trying || !tried ? "neutral" : tried.ok ? "ok" : "fail"}
        shake={refused}
        onPress={tryIt}
      />

      {/* The control that goes ahead sits on the right. */}
      <View style={styles.actions}>
        <Button label={t("targets.cancel")} onPress={() => nav.goBack()} />
        <Button label={t("targets.save")} labelKey="targets.save" tone="accent" busy={saving} onPress={save} />
      </View>
    </Page>
  );
}

/** Drops empty values, since an empty secret means "keep the saved one". */
function prune(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value.trim() !== "") out[key] = value;
  }
  return out;
}

/** Translates common rclone option names; others keep their own name. */
function label(option: string, t: T): string {
  const known: Record<string, TranslationKey> = {
    user: "opt.user",
    username: "opt.user",
    pass: "opt.pass",
    password: "opt.pass",
    host: "opt.host",
    url: "opt.url",
    port: "opt.port",
    token: "opt.token",
    vendor: "opt.vendor",
    provider: "opt.provider",
    region: "opt.region",
    endpoint: "opt.endpoint",
    account: "opt.account",
    key: "opt.key",
    access_key_id: "opt.accessKey",
    secret_access_key: "opt.secretKey",
    client_id: "opt.clientId",
    client_secret: "opt.clientSecret",
    remote: "opt.remote",
    library: "opt.library",
  };
  const key = known[option];
  return key ? t(key) : option;
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: space.sm },
});
