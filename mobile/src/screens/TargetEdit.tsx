import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { api, type Backend, type Provider, type Remote } from "../api";
import { Field } from "../fields";
import { useT, type T } from "../i18n";
import type { TranslationKey } from "../i18n";
import type { Nav, TargetsStack } from "../nav";
import { suggestTargetName } from "../../../web/src/lib/targetName";
import { space } from "../theme";
import { Body, Button, Caption, Empty, Page, Section, Title } from "../ui";

/**
 * Setting a target up, from what the BACKEND says it needs.
 *
 * The fields are not a hand-kept list per provider. rclone ships, with every
 * build, which options a backend requires and which are essential; the engine
 * passes that through, and this draws a field for each. A hand-written list
 * would be right on the day it was written and quietly wrong a year later.
 *
 * The provider's PRESET is applied underneath - the values that make a generic
 * backend into a named product, like the S3 provider or a WebDAV vendor. They
 * are not shown, because they are not questions: somebody who picked Wasabi
 * does not also need to be told the answer is `Wasabi`.
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
        // The name, suggested rather than demanded. jdp: "Bitte auch in der App
        // soll der Name der Verbindung schon vorausgefüllt sein." Somebody who
        // just pressed Nextcloud has already said what this is, and asking them
        // to type it again is asking twice. Same rule as the desktop, from the
        // same function, numbered where the name is already in use.
        const picked = s.providers.find((x) => x.id === providerId);
        if (!editing && picked) {
          setName((old) => (old ? old : suggestTargetName(picked.name, s.remotes.map((r) => r.name))));
        }
        // The unlisted backends too: a product entry covers most of what
        // rclone carries and not all of it, and a target for one of the rest
        // still has to be editable.
        setBackends([...s.backends, ...s.unlisted]);
        const found = s.remotes.find((r) => r.name === editing) ?? null;
        setExisting(found);
        if (found) {
          const start: Record<string, string> = {};
          for (const setting of found.settings) {
            // A secret comes back withheld. Leaving the field EMPTY rather than
            // filling it with the placeholder is what lets somebody keep the
            // password they already set by not touching it.
            if (!setting.secret) start[setting.key] = setting.value;
          }
          setValues(start);
        }
      },
      (e: Error) => setError(e.message),
    );
    // The suggestion cannot be made at first render: the provider's own NAME
    // and the names already taken both arrive with the storage list, one round
    // trip later. `setName` only fills an EMPTY field, so a name somebody has
    // already typed while this was in flight survives.
  }, [editing, providerId]);

  const provider = useMemo(
    () =>
      providers.find((x) => x.id === providerId) ??
      providers.find((x) => x.backend === existing?.type) ??
      null,
    [providers, providerId, existing],
  );

  const backendName = provider?.backend ?? existing?.type ?? "";
  const backend = useMemo(
    () => backends.find((b) => b.name === backendName) ?? null,
    [backends, backendName],
  );

  // Required first, then the ones rclone calls essential. Everything else is
  // behind nothing at all: an option somebody needs but cannot see is worse on
  // a phone than a longer page, because there is no settings dialog to go
  // hunting in.
  const options = useMemo(() => {
    const all = backend?.options ?? [];
    const preset = provider?.preset ?? {};
    return all
      .filter((o) => (o.required || o.essential) && !(o.name in preset))
      .sort((a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)));
  }, [backend, provider]);

  if (!backendName) {
    return <Empty title={t("targets.addStorage")} detail={error || t("history.working")} />;
  }

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
        // An OAuth backend cannot be set up by typing: it needs a browser round
        // trip that ends in a token. Saying so and pointing at the page beats a
        // form that looks fillable and produces a target that never works.
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

      {/* NOT `targets.advanced`, which on the desktop is the label of a switch
          reading "Show every setting". As a card title it promised a card that
          reveals more and delivered a card that lists two fields. This card
          holds how the target is REACHED - an account and a key, a host and a
          password, an address - so that is what it is called. */}
      <Section
        title={t("targets.access")}
        hint={provider?.urlHint ? t("help.addressShape", { shape: provider.urlHint }) : undefined}
      >
        {options.map((option) => (
          <Field
            key={option.name}
            label={label(option.name, t)}
            hint={option.help}
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

      <View style={styles.actions}>
        <Button label={t("targets.save")} labelKey="targets.save" tone="accent" busy={saving} onPress={save} />
        <Button label={t("targets.cancel")} onPress={() => nav.goBack()} />
      </View>
    </Page>
  );
}

/** Empty strings are NOT sent. An empty secret means "leave the one that is
 *  already there"; sending it would erase a password by opening a form. */
function prune(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value.trim() !== "") out[key] = value;
  }
  return out;
}

/** rclone's option names, in the words the rest of the app uses. Anything
 *  without a translation keeps its own name, which is better than a guess. */
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
