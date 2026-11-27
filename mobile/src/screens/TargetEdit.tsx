import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { api, EngineError, type Backend, type Provider, type Remote, type SetupQuestion, type TryAnswer } from "../api";
import { Field, SecretField } from "../fields";
import { useT } from "../i18n";
import type { Nav, MoreStack } from "../nav";
import { saveTarget } from "../targetSave";
import { CERTIFICATE_KEY } from "../../../web/src/lib/certificate";
import { failureLine } from "../../../web/src/lib/failure";
import { optionHint, providerHint, providerName } from "../../../web/src/lib/optionHint";
import { optionLabel } from "../../../web/src/lib/optionNames";
import { FTP_TLS, ftpTls, withFtpTls } from "../../../web/src/lib/ftpTls";
import { KDRIVE_ROOTS, kdriveRoot, kdriveRootValue } from "../../../web/src/lib/kdriveRoot";
import { anySaved, settingsToSave } from "../../../web/src/lib/savedSettings";
import { oneTimeCode, questionHint, questionLabel, typedAnswer } from "../../../web/src/lib/setupQuestion";
import { suggestTargetName, TARGET_LABEL_MAX } from "../../../web/src/lib/targetName";
import { withTargetIds } from "../../../web/src/lib/wrappedTarget";
import { TargetIdRow, UpstreamsField, WrapField } from "../wrappedTarget";
import { space } from "../theme";
import { Body, Button, Caption, Choice, Empty, Page, Pair, PickRow, Row, Section, Title, Toggle } from "../ui";

type Option = NonNullable<Backend["options"]>[number];

/**
 * The target form. It asks for the options rclone marks required or essential
 * for the backend and folds the others away. The provider's preset (such as
 * the S3 provider name) is applied underneath and not shown.
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
  // Every saved target but this one, which a wrapping target picks from.
  const [targets, setTargets] = useState<Remote[]>([]);
  const [name, setName] = useState(editing ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  /** Why the name cannot be saved. */
  const [nameError, setNameError] = useState("");
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
          setName((old) => (old ? old : suggestTargetName(picked.name, s.remotes.map((r) => r.label || r.name))));
        }
        // Backends no provider entry covers still have to be editable.
        setBackends([...s.backends, ...s.unlisted]);
        const found = s.remotes.find((r) => r.name === editing) ?? null;
        setExisting(found);
        setTargets(s.remotes.filter((r) => r.name !== editing));
        if (found) {
          setName(found.label || found.name);
          const start: Record<string, string> = {};
          // A stored secret arrives as the placeholder, which saving sends
          // back untouched so the engine keeps it.
          for (const setting of found.settings) start[setting.key] = setting.value;
          setValues(withTargetIds(start, s.remotes, found.type === "combine"));
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

  // Required options first, then the ones rclone calls essential. The rest
  // are folded away, since s3 alone has dozens.
  const [options, others] = useMemo(() => {
    const all = (backend?.options ?? []).filter((o) => !(o.name in (provider?.preset ?? {})));
    const asked = (o: Option) => Boolean(o.required || o.essential);
    return [
      all.filter(asked).sort((a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required))),
      all.filter((o) => !asked(o)),
    ];
  }, [backend, provider]);

  // The connection test's state. These hooks have to stay above the early
  // return, or the hook count changes between renders.
  const [trying, setTrying] = useState(false);
  const [tried, setTried] = useState<TryAnswer | null>(null);
  // A counter rather than a flag, so every failed attempt shakes the button.
  const [refused, setRefused] = useState(0);
  // What rclone's setup left to choose at the last test.
  const [question, setQuestion] = useState<SetupQuestion | null>(null);
  // Unset until somebody opens or closes the fold.
  const [othersOpen, setOthersOpen] = useState<boolean | null>(null);

  if (!backendName) {
    return <Empty title={t("targets.addStorage")} detail={error || t("history.working")} />;
  }

  const answered = (answer: TryAnswer) => {
    if (answer.question) setQuestion(answer.question);
    setTried(answer.question ? { ok: false, reason: t(questionHint(answer.question)) } : answer);
    if (!answer.ok) setRefused((n) => n + 1);
  };

  const tryIt = async (sent = values) => {
    setTrying(true);
    setTried(null);
    try {
      answered(
        await api.tryRemote(
          backendName,
          { ...(provider?.preset ?? {}), ...prune(sent) },
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

  const othersShown = othersOpen ?? anySaved(existing?.settings ?? [], others.map((o) => o.name));

  const field = (option: Option) => {
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
    if (backendName === "kdrive" && option.name === "root_folder_id") {
      return (
        <KdriveRootField
          key={option.name}
          value={values.root_folder_id ?? ""}
          onChange={(next) => setValues((old) => ({ ...old, root_folder_id: next }))}
        />
      );
    }
    if (option.name === "remote") {
      return (
        <WrapField
          key={option.name}
          label={optionLabel(option.name, t, backendName)}
          hint={optionHint(option, t, provider)}
          value={values.remote ?? ""}
          targets={targets}
          onChange={(next) => setValues((old) => ({ ...old, remote: next }))}
        />
      );
    }
    if (option.name === "upstreams") {
      return (
        <UpstreamsField
          key={option.name}
          label={optionLabel(option.name, t, backendName)}
          hint={optionHint(option, t, provider)}
          value={values.upstreams ?? ""}
          targets={targets}
          combine={backendName === "combine"}
          onChange={(next) => setValues((old) => ({ ...old, upstreams: next }))}
        />
      );
    }
    if (option.type === "bool") {
      // Off is left unsaved where it is rclone's default.
      return (
        <Toggle
          key={option.name}
          label={optionLabel(option.name, t, backendName)}
          hint={optionHint(option, t, provider)}
          value={(values[option.name] || option.default) === "true"}
          onChange={(on) =>
            setValues((old) => ({ ...old, [option.name]: String(on) === option.default ? "" : String(on) }))
          }
        />
      );
    }
    // An empty field shows rclone's name, which its documentation uses, and
    // the default goes in the bubble, where nobody takes it for a value
    // already filled in.
    const props = {
      label: optionLabel(option.name, t, backendName),
      hint: optionHint(option, t, provider),
      value: values[option.name] ?? "",
      onChange: (next: string) => setValues((old) => ({ ...old, [option.name]: next })),
      placeholder: option.name,
      hidePlaceholderOnFocus: true,
    };
    return option.secret ? <SecretField key={option.name} {...props} /> : <Field key={option.name} {...props} />;
  };

  const reason = tried && !tried.ok && tried.reason ? failureLine(tried.reason, tried.failure, t, lang) : "";

  // Holds the target to the certificate the test refused, and tests again with it.
  const trust = (fingerprint: string) => {
    const next = { ...values, [CERTIFICATE_KEY]: fingerprint };
    setValues(next);
    void tryIt(next);
  };
  const pinned = values[CERTIFICATE_KEY] ?? "";
  const refusedCert = backend?.trustsCertificate && tried && !tried.ok ? tried.certificate : undefined;

  const save = async () => {
    setSaving(true);
    setError("");
    setNameError("");
    try {
      const done = await saveTarget(api, existing?.name, name, {
        type: backendName,
        settings: { ...(provider?.preset ?? {}), ...settingsToSave(values, existing?.settings ?? []) },
      });
      if ("refused" in done) {
        // Said under the field and beside the buttons, which is where the
        // finger is when Save was pressed.
        const why = t(done.refused.key, done.refused.vars);
        setNameError(why);
        setError(why);
        return;
      }
      nav.popToTop();
    } catch (e) {
      // The test is where the form asks the question the save is waiting for.
      if (e instanceof EngineError && e.status === 422) void tryIt();
      else if (e instanceof EngineError && e.failure) setError(failureLine(e.message, e.failure, t, lang));
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
          onChange={(next) => {
            setName(next);
            setNameError("");
          }}
          placeholder={provider?.name ?? backendName}
          maxLength={TARGET_LABEL_MAX}
          error={nameError || undefined}
        />
        {existing ? <TargetIdRow id={existing.name} /> : null}
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
        {options.map(field)}
        {options.length === 0 ? <Body>{t("phone.noSettings")}</Body> : null}
      </Section>

      {/* Opens by itself where the saved target uses one of these, so a
          setting in use never hides behind the fold. */}
      {others.length > 0 ? (
        <Section title={t("targets.moreSettings")}>
          <Button
            label={t(othersShown ? "anomaly.showLess" : "anomaly.showMore")}
            labelKey={othersShown ? "anomaly.showLess" : "anomaly.showMore"}
            onPress={() => setOthersOpen(!othersShown)}
          />
          {othersShown ? others.map(field) : null}
        </Section>
      ) : null}

      {question ? (
        <Section title={t(questionLabel(question))} hint={t(questionHint(question))}>
          {typedAnswer(question) ? (
            <Field
              label={t(questionLabel(question))}
              value={values[question.name] ?? ""}
              onChange={(next) => setValues((old) => ({ ...old, [question.name]: next }))}
              keyboard={oneTimeCode(question) ? "numeric" : "default"}
            />
          ) : (
            question.choices.map((choice) => (
              <PickRow
                key={choice.value}
                on={values[question.name] === choice.value}
                onPress={() => setValues((old) => ({ ...old, [question.name]: choice.value }))}
              >
                <Body>{choice.help || choice.value}</Body>
              </PickRow>
            ))
          )}
        </Section>
      ) : null}

      {error ? <Body>{error}</Body> : null}

      {/* Only the reason: the button itself shows the verdict. Kept mounted,
          since TalkBack announces a live region when its text changes. */}
      <View accessibilityLiveRegion="polite">{reason ? <Body>{reason}</Body> : null}</View>
      {tried?.hostKey ? (
        <Section title={t("targets.hostKey")} hint={t("targets.hostKeyHint")}>
          <Body>{tried.hostKey}</Body>
        </Section>
      ) : null}
      {refusedCert ? (
        <Section title={t(refusedCert.changed ? "targets.certificate.changed" : "targets.certificate.untrusted")}>
          <Body>{t(refusedCert.changed ? "targets.certificate.changedHint" : "targets.certificate.untrustedHint")}</Body>
          <Pair label={t("targets.certificate.fingerprint")} value={refusedCert.fingerprint} />
          {refusedCert.subject ? (
            <Pair label={t("targets.certificate.subject")} value={refusedCert.subject} />
          ) : null}
          {refusedCert.issuer ? <Pair label={t("targets.certificate.issuer")} value={refusedCert.issuer} /> : null}
          {refusedCert.notAfter ? (
            <Pair
              label={t("targets.certificate.validUntil")}
              value={new Date(refusedCert.notAfter).toLocaleDateString(lang)}
            />
          ) : null}
          <Button
            label={t("targets.certificate.trust")}
            labelKey="targets.certificate.trust"
            glyph="IconShieldOn"
            busy={trying}
            onPress={() => trust(refusedCert.fingerprint)}
          />
        </Section>
      ) : pinned ? (
        <Section title={t("targets.certificate.trusted")} hint={t("targets.certificate.trustedHint")}>
          <Body>{pinned}</Body>
          <Button
            label={t("targets.certificate.remove")}
            labelKey="targets.certificate.remove"
            glyph="IconShieldOff"
            onPress={() => setValues((old) => ({ ...old, [CERTIFICATE_KEY]: "" }))}
          />
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
        spoken={reason ? `${t("targets.checkFailed")}: ${reason}` : undefined}
        shake={refused}
        onPress={() => void tryIt()}
      />

      {/* The control that goes ahead sits on the right. */}
      <View style={styles.actions}>
        <Button label={t("targets.cancel")} labelKey="targets.cancel" onPress={() => nav.goBack()} />
        <Button label={t("targets.save")} labelKey="targets.save" tone="accent" busy={saving} onPress={save} />
      </View>
    </Page>
  );
}

/**
 * kDrive's root folder: the private folder, the shared one, or another by its
 * ID. Which of the three is picked is kept here, since an ID still being typed
 * is empty and would read as the private folder.
 */
function KdriveRootField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useT();
  const [byId, setById] = useState(() => kdriveRoot(value) === "id");
  const mode = byId ? "id" : kdriveRoot(value);
  return (
    <View style={styles.choice}>
      <Row
        label={t("targets.kdriveRoot")}
        hint={[t("targets.kdriveRootHint"), t("help.rcloneName", { name: "root_folder_id" })].join(" ")}
      />
      <Choice
        value={mode}
        onChange={(next) => {
          setById(next === "id");
          onChange(kdriveRootValue(next));
        }}
        options={KDRIVE_ROOTS.map((root) => ({ value: root, label: t(`targets.kdriveRoot.${root}`) }))}
      />
      {byId ? (
        <Field label={t("targets.kdriveFolderId")} hint={t("targets.kdriveFolderIdHint")} value={value} onChange={onChange} />
      ) : null}
    </View>
  );
}

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
