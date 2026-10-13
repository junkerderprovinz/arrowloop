import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";

import { channelOn, notifyWhen, type Channel, type Notify, type When } from "../../../web/src/lib/notify";
import { api } from "../api";
import { Field, NumberField } from "../fields";
import { useT } from "../i18n";
import { AxisLabel, Body, Button, Choice, Row, Section, Toggle } from "../ui";

/** What the engine sends in place of a secret it keeps. */
const WITHHELD = "********";

/**
 * When the engine sends a message and through which channels, as on the
 * browser's Safety net tile. The phone's engine is the same program, so a
 * channel set here sends from the phone. Text is written when its box is
 * left, since every write reloads the settings and would refill a box mid-word.
 */
export function NotifySection({
  notify,
  save,
  hue,
}: {
  notify: Notify;
  save: (next: Notify) => void;
  hue: number;
}) {
  const { t } = useT();
  const [jobs, setJobs] = useState<string[]>([]);
  useEffect(() => {
    api.jobs().then((list) => setJobs(list.map((j) => j.name)), () => {});
  }, []);

  const set = (next: Partial<Notify>) => save({ ...notify, ...next });
  const matrix = notify.matrix ?? { homeserver: "", room: "", token: "" };
  const setMatrix = (next: Partial<typeof matrix>) => set({ matrix: { ...matrix, ...next } });
  const smtp = notify.smtp ?? {};
  const setSmtp = (next: Partial<typeof smtp>) => set({ smtp: { ...smtp, ...next } });
  const apprise = notify.apprise ?? {};
  const setApprise = (next: Partial<typeof apprise>) => set({ apprise: { ...apprise, ...next } });
  const checks = notify.healthchecks ?? {};
  const setChecks = (next: Partial<typeof checks>) => set({ healthchecks: { ...checks, ...next } });

  // The channel's name is its switch, since the phone has no sub-cards.
  const channel = (which: Channel, label: string, hint: string, n: number, fields: () => ReactNode) => (
    <>
      <Toggle
        label={label}
        hint={hint}
        hue={n}
        value={channelOn(notify, which)}
        onChange={(on) => {
          if (which === "webhook") set({ webhookEnabled: on });
          else if (which === "matrix") setMatrix({ enabled: on });
          else if (which === "smtp") setSmtp({ enabled: on });
          else if (which === "apprise") setApprise({ enabled: on });
          else setChecks({ enabled: on });
        }}
      />
      {channelOn(notify, which) ? (
        <>
          {fields()}
          <TestButton channel={which} notify={notify} />
        </>
      ) : null}
    </>
  );

  return (
    <Section title={t("settings.notifications")} hue={hue}>
      <AxisLabel hint={t("notify.whenHint")}>{t("notify.when")}</AxisLabel>
      <Choice<When>
        hue={0}
        value={notifyWhen(notify)}
        // onSuccess is the older spelling of always, and a written on outranks it.
        onChange={(on) => set({ on, onSuccess: undefined })}
        options={[
          { value: "never", label: t("notify.whenNever") },
          { value: "failure", label: t("notify.whenFailure") },
          { value: "always", label: t("notify.whenAlways") },
        ]}
      />

      {channel("webhook", t("notify.webhook"), t("notify.webhookHint"), 1, () => (
        <>
          <SecretField
            label={t("notify.address")}
            value={notify.webhook ?? ""}
            onSave={(webhook) => set({ webhook })}
            placeholder="https://ntfy.sh/..."
          />
          <AxisLabel>{t("notify.format")}</AxisLabel>
          <Choice
            hue={1}
            value={notify.webhookFormat || "generic"}
            onChange={(webhookFormat) => set({ webhookFormat })}
            options={[
              { value: "generic", label: "JSON" },
              { value: "discord", label: "Discord" },
              { value: "slack", label: "Slack" },
              { value: "gotify", label: "Gotify" },
              { value: "ntfy", label: "ntfy" },
            ]}
          />
        </>
      ))}

      {channel("matrix", t("notify.matrix"), t("notify.matrixHint"), 2, () => (
        <>
          <TextField label={t("engine.matrixHome")} value={matrix.homeserver} onSave={(homeserver) => setMatrix({ homeserver })} placeholder="https://matrix.example.org" />
          <TextField label={t("engine.matrixRoom")} value={matrix.room} onSave={(room) => setMatrix({ room })} placeholder="!abc:example.org" />
          <SecretField label={t("engine.matrixToken")} value={matrix.token} onSave={(token) => setMatrix({ token })} />
        </>
      ))}

      {channel("smtp", t("notify.smtp"), t("notify.smtpHint"), 3, () => (
        <>
          <TextField label={t("notify.smtpHost")} value={smtp.host ?? ""} onSave={(host) => setSmtp({ host })} placeholder="mail.example.org" />
          <AxisLabel>{t("notify.smtpTls")}</AxisLabel>
          <Choice
            hue={2}
            value={smtp.tls || "starttls"}
            onChange={(tls) => setSmtp({ tls })}
            options={[
              { value: "starttls", label: "STARTTLS" },
              { value: "tls", label: "TLS" },
              { value: "none", label: t("notify.tlsNone") },
            ]}
          />
          <NumberField
            label={t("notify.smtpPort")}
            value={String(smtp.port ?? (smtp.tls === "tls" ? 465 : 587))}
            onChange={(v) => {
              const port = Number(v);
              if (Number.isInteger(port) && port > 0 && port < 65536) setSmtp({ port });
            }}
          />
          <TextField label={t("notify.smtpUser")} value={smtp.username ?? ""} onSave={(username) => setSmtp({ username })} />
          <SecretField label={t("notify.smtpPassword")} value={smtp.password ?? ""} onSave={(password) => setSmtp({ password })} />
          <TextField label={t("notify.smtpFrom")} value={smtp.from ?? ""} onSave={(from) => setSmtp({ from })} placeholder="arrowloop@example.org" />
          <TextField label={t("notify.smtpTo")} hint={t("notify.smtpToHint")} value={smtp.to ?? ""} onSave={(to) => setSmtp({ to })} placeholder="me@example.org" />
        </>
      ))}

      {channel("apprise", t("notify.apprise"), t("notify.appriseHint"), 4, () => (
        <>
          <SecretField label={t("notify.address")} value={apprise.url ?? ""} onSave={(url) => setApprise({ url })} placeholder="http://apprise:8000/notify/arrowloop" />
          <TextField label={t("notify.appriseTags")} hint={t("notify.appriseTagsHint")} value={apprise.tags ?? ""} onSave={(tags) => setApprise({ tags })} placeholder="backups" />
        </>
      ))}

      {channel("healthchecks", t("notify.healthchecks"), t("notify.healthchecksHint"), 5, () => (
        <>
          <SecretField label={t("notify.hcShared")} value={checks.url ?? ""} onSave={(url) => setChecks({ url })} placeholder="https://hc-ping.com/..." />
          {/* A phone has a handful of jobs, so each gets its box; an empty one
              pings the shared check. */}
          <AxisLabel hint={t("notify.hcJobsHint")}>{t("notify.hcJobs")}</AxisLabel>
          {jobs.map((name) => (
            <SecretField
              key={name}
              label={name}
              value={checks.jobs?.[name] ?? ""}
              onSave={(url) => setChecks({ jobs: { ...(checks.jobs ?? {}), [name]: url } })}
              placeholder="https://hc-ping.com/..."
            />
          ))}
        </>
      ))}
    </Section>
  );
}

/** A text box that writes when it is left. */
function TextField({
  label,
  hint,
  value,
  onSave,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <Field
      label={label}
      hint={hint}
      value={typed ?? value}
      placeholder={placeholder}
      onChange={setTyped}
      onBlur={() => {
        if (typed !== null && typed !== value) onSave(typed);
        setTyped(null);
      }}
    />
  );
}

/**
 * A stored secret, shown as Saved with a Change button: the engine never sends
 * it back, so a box could only show dots that are not the secret.
 */
function SecretField({
  label,
  value,
  onSave,
  placeholder,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
}) {
  const { t } = useT();
  const [changing, setChanging] = useState(false);
  const [typed, setTyped] = useState("");
  if (value === WITHHELD && !changing) {
    return (
      <Row
        label={label}
        control={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Body muted>{t("notify.saved")}</Body>
            <Button label={t("notify.change")} labelKey="notify.change" onPress={() => setChanging(true)} />
          </View>
        }
      />
    );
  }
  const stored = value === WITHHELD;
  return (
    <View>
      <Field
        label={label}
        secret
        value={stored ? typed : (typed || value)}
        placeholder={placeholder}
        onChange={setTyped}
        onBlur={() => {
          if (typed && typed !== value) {
            onSave(typed);
            setChanging(false);
            setTyped("");
          }
        }}
      />
      {changing ? (
        <Button
          label={t("notify.keep")}
          labelKey="notify.keep"
          onPress={() => {
            setChanging(false);
            setTyped("");
          }}
        />
      ) : null}
    </View>
  );
}

/** Sends a test through one channel and says how it went. */
function TestButton({ channel, notify }: { channel: Channel; notify: Notify }) {
  const { t } = useT();
  const [sending, setSending] = useState(false);
  const [verdict, setVerdict] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [refused, setRefused] = useState(0);

  useEffect(() => setVerdict(null), [notify]);

  async function send() {
    setSending(true);
    setVerdict(null);
    try {
      const answer = await api.testNotify(channel, notify);
      setVerdict(answer);
      if (!answer.ok) setRefused((n) => n + 1);
    } catch (e) {
      setVerdict({ ok: false, reason: (e as Error).message });
      setRefused((n) => n + 1);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        label={sending ? t("notify.testing") : !verdict ? t("notify.test") : verdict.ok ? t("notify.testOk") : t("notify.testFailed")}
        labelKey="notify.test"
        glyph={!verdict || sending ? undefined : verdict.ok ? "IconCheck" : "IconClose"}
        tone={sending || !verdict ? "neutral" : verdict.ok ? "ok" : "fail"}
        busy={sending}
        shake={refused}
        onPress={() => void send()}
      />
      {verdict && !verdict.ok && verdict.reason ? <Body>{verdict.reason}</Body> : null}
    </>
  );
}
