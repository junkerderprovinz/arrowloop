import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { api, EngineError, type Backend, type Provider, type Remote, type SetupQuestion } from "../api";
import { Field, SecretField } from "../fields";
import { useT } from "../i18n";
import type { Nav, MoreStack } from "../nav";
import { failureLine, type Failure } from "../../../web/src/lib/failure";
import { optionHint, providerHint, providerName } from "../../../web/src/lib/optionHint";
import { optionLabel } from "../../../web/src/lib/optionNames";
import { FTP_TLS, ftpTls, withFtpTls } from "../../../web/src/lib/ftpTls";
import { suggestTargetName } from "../../../web/src/lib/targetName";
import { space } from "../theme";
import { Body, Button, Caption, Choice, Empty, Page, PickRow, Row, Section, Title, Toggle } from "../ui";
import type { TranslationKey } from "../../../web/src/lib/i18n.data";

/**
 * The target form. Its fields are the options rclone marks required or
 * essential for the backend; the provider's preset (such as the S3 provider
 * name) is applied underneath and not shown.
 */
export function TargetEdit() {
  const route = useRoute<RouteProp<MoreStack, "TargetEdit">>();
  const nav = useNavigation<Nav<MoreStack>>();
  const { t, lang } = useT();
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
          // A stored secret arrives as the placeholder, which saving sends
          // back untouched so the engine keeps it.
          for (const setting of found.settings) start[setting.key] = setting.value;
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
  const about = provider ? providerHint(provider.id, t) : undefined;

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
  const [tried, setTried] = useState<{ ok: boolean; reason?: string; failure?: Failure; hostKey?: string } | null>(null);
  // A counter rather than a flag, so every failed attempt shakes the button.
  const [refused, setRefused] = useState(0);
  // What rclone's setup left to choose at the last test.
  const [question, setQuestion] = useState<SetupQuestion | null>(null);

  if (!backendName) {
    return <Empty title={t("targets.addStorage")} detail={error || t("history.working")} />;
  }

  const answered = (answer: { ok: boolean; reason?: string; failure?: Failure; question?: SetupQuestion; hostKey?: string }) => {
    if (answer.question) setQuestion(answer.question);
    setTried(answer.question ? { ok: false, reason: t("targets.question.hint") } : answer);
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
      // The test is where the form asks the question the save is waiting for.
      if (e instanceof EngineError && e.status === 422) void tryIt();
      else setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <Title>{provider ? providerName(provider, t) : backendName}</Title>
      {about ? <Caption>{about}</Caption> : null}

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
        {options.map((option) => {
          if (backendName === "ftp" && option.name === "explicit_tls") return null;
          if (backendName === "ftp" && option.name === "tls") {
            return (
              <View key={option.name} style={styles.choice}>
                <Row label={t("targets.ftpTls")} hint={t("targets.ftpTlsHint")} />
                <Choice
                  value={ftpTls(values)}
                  onChange={(mode) => setValues((old) => withFtpTls(old, mode))}
                  options={FTP_TLS.map((mode) => ({ value: mode, label: t(`targets.ftpTls.${mode}`) }))}
                />
              </View>
            );
          }
          if (option.type === "bool") {
            // Off is left unsaved where it is rclone's default.
            return (
              <Toggle
                key={option.name}
                label={optionLabel(option.name, t)}
                hint={optionHint(option, t, provider)}
                value={(values[option.name] || option.default) === "true"}
                onChange={(on) =>
                  setValues((old) => ({ ...old, [option.name]: String(on) === option.default ? "" : String(on) }))
                }
              />
            );
          }
          const props = {
            label: optionLabel(option.name, t),
            hint: optionHint(option, t, provider),
            value: values[option.name] ?? "",
            onChange: (next: string) => setValues((old) => ({ ...old, [option.name]: next })),
          };
          return option.secret ? <SecretField key={option.name} {...props} /> : <Field key={option.name} {...props} />;
        })}
        {options.length === 0 ? <Body>{t("phone.noSettings")}</Body> : null}
      </Section>

      {question ? (
        <Section title={t(QUESTION_LABELS[question.name] ?? "targets.question.other")} hint={t("targets.question.hint")}>
          {question.choices.map((choice) => (
            <PickRow
              key={choice.value}
              on={values[question.name] === choice.value}
              onPress={() => setValues((old) => ({ ...old, [question.name]: choice.value }))}
            >
              <Body>{choice.help || choice.value}</Body>
            </PickRow>
          ))}
        </Section>
      ) : null}

      {error ? <Body>{error}</Body> : null}

      {/* Only the reason: the button itself shows the verdict. */}
      {tried && !tried.ok && tried.reason ? <Body>{failureLine(tried.reason, tried.failure, t, lang)}</Body> : null}
      {tried?.hostKey ? (
        <Section title={t("targets.hostKey")} hint={t("targets.hostKeyHint")}>
          <Body>{tried.hostKey}</Body>
        </Section>
      ) : null}

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
        glyph={!tried || trying ? undefined : tried.ok ? "IconCheck" : "IconClose"}
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

/** The questions rclone's setups ask, by the setting that answers them. */
const QUESTION_LABELS: Record<string, TranslationKey> = {
  config_driveid: "targets.question.drive",
  config_workspace: "targets.question.workspace",
  config_team_drive_id: "targets.question.team",
};

/** Drops empty values, since a secret left empty while changing it means "keep the saved one". */
function prune(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value.trim() !== "") out[key] = value;
  }
  return out;
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: space.sm },
  choice: { gap: space.sm },
});
