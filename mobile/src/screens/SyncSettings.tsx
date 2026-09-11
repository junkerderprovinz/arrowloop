import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { heldKey } from "../deviceConditions";
import { engine, type DeviceConditions, type DevicePolicy } from "../engine";
import { useT } from "../i18n";
import { useEngineSettings } from "../settings";
import { Field } from "../fields";
import { Schedule } from "./JobEdit";
import { AxisLabel, Body, Choice, Page, Section, Toggle } from "../ui";

/**
 * Everything a job starts from, on one page.
 *
 * It was FIVE separate cards on the settings page - what a job does, how hard
 * it pushes, what travels, the brakes, and when the phone lets a due job go
 * ahead - sitting among the accent colour, the language, the three permissions
 * and the backup. Fifteen cards on one page, five of them answering one
 * question. jdp: "du sollst nicht nur neue features in die globalen sync
 * einstellungen aufnehmen sondern auch bestehende einstellungen die jetzt
 * separat sind darin aufnehmen."
 *
 * Autosync puts the same group behind one entry called "Synchronisation" and
 * the reason holds for this app too: these are settings somebody visits while
 * setting the app UP, not settings they pass on the way to the corner radius.
 * A page somebody chooses to open can be as long as it needs to be; a page
 * everybody scrolls through cannot.
 *
 * WHAT A DEFAULT IS, said once here rather than on each card: a job that says
 * nothing about a setting takes the value from this page, and a job that says
 * something keeps its own answer. So changing one of these changes every job
 * that never disagreed, and none of the jobs that did.
 */
export function SyncSettings() {
  const { t } = useT();
  const [policy, setPolicy] = useState<DevicePolicy | null>(null);

  const { settings, update } = useEngineSettings(true);
  const defaults = (settings?.defaults ?? {}) as Record<string, unknown>;
  const saveDefaults = (patch: Record<string, unknown>) =>
    update({ defaults: { ...defaults, ...patch } });

  const refresh = useCallback(async () => {
    setPolicy(await engine.devicePolicy().catch(() => null));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** A condition, stored on the phone AND told to the engine at once: the
   *  engine is what holds a run back, and Kotlin is what watches the battery
   *  and the connection while the screen is off.
   *
   *  Only what changed is sent. The bridge merges, so a switch here cannot
   *  overwrite a setting this screen happens not to be showing. */
  const setConditions = (patch: Partial<DeviceConditions>) => {
    setPolicy((old) => (old ? { ...old, ...patch } : old));
    engine.setDevicePolicy(patch).then(refresh, () => refresh());
  };

  const retry = (settings?.retry ?? {}) as Record<string, unknown>;
  const saveRetry = (patch: Record<string, unknown>) =>
    update({ retry: { ...retry, ...patch } });

  // In the app's own words, not the engine's. The engine is told an English
  // sentence because that sentence lands in a log beside every other line it
  // wrote; this page used to print that sentence straight out of Kotlin, so a
  // German phone read "this phone is not charging".
  const heldAt = heldKey(policy);
  const held = heldAt ? t(heldAt) : "";

  return (
    <Page>
      {/* What a new job starts from. The engine has carried defaults for a
          while and they were only reachable by editing the file: a job that
          says nothing about a setting takes the default, and a job that says
          something keeps its own answer. Setting the pair here once is the
          difference between "everything on this phone goes up and the space
          comes back" being one decision or one per job. */}
      <Section title={t("engine.defaults")} hint={t("defaults.followHint")} hue={0}>
        <AxisLabel>{t("direction.label")}</AxisLabel>
        <Choice
          value={String(defaults.direction ?? "both")}
          onChange={(direction) =>
            saveDefaults({ direction, mode: direction === "both" ? "sync" : defaults.mode })
          }
          options={[
            { value: "both", label: t("direction.both") },
            { value: "leftToRight", label: t("direction.toRight") },
            { value: "rightToLeft", label: t("direction.toLeft") },
          ]}
        />
        {/* Both ways has no choice to make here, and the selector says so by
            going inert with `sync` still showing rather than vanishing. A
            paragraph used to stand in its place, which left the card two
            different shapes depending on the answer above it - and the reason
            belongs in the (i) like every other reason in this app. */}
        {(() => {
          const both = (defaults.direction ?? "both") === "both";
          return (
            <>
              {/* THE THREE MODES, EXPLAINED. They were three words in a well
                  and nothing else - "Nur kopieren", "Spiegeln", "Verschieben" -
                  and the difference between them is the difference between a
                  job that never deletes anything and one that does. jdp: "die
                  modi nur kopieren, spiegeln und verschieben bitte erklären."

                  Assembled from the three hints the translation table already
                  carries rather than written again: they exist in all forty
                  languages, they were simply never shown on this surface. All
                  three at once rather than the chosen one, because the question
                  somebody has while looking at this row is what the DIFFERENCE
                  is, and a description of the option already picked does not
                  answer it. */}
              <AxisLabel hint={both ? t("mode.onlyOneWay") : modeHint(t)}>
                {t("mode.label")}
              </AxisLabel>
              <Choice
                disabled={both}
                value={both ? "sync" : String(defaults.mode ?? "sync")}
                onChange={(mode) => saveDefaults({ mode })}
                options={[
                  { value: "sync", label: t("mode.sync") },
                  { value: "mirror", label: t("mode.mirror") },
                  { value: "move", label: t("mode.move") },
                ]}
              />
            </>
          );
        })()}
        {/* The schedule belongs with the pair above it, not on its own: "every
            night at three" is a decision about a PHONE far more often than
            about one folder, which is why the engine has carried it as a
            default all along. It was reachable only by editing the file. */}
        <AxisLabel>{t("edit.schedule")}</AxisLabel>
        <Schedule
          value={String(defaults.schedule ?? "")}
          onChange={(schedule) => saveDefaults({ schedule })}
        />
      </Section>

      {/* How much at once, and how long to wait for a folder to settle. Its own
          card because Autosync groups the same two that way and the reason
          holds: these answer "how hard does it push", where the card above
          answers "what does it do". */}
      <Section title={t("settings.transfer")} hue={1}>
        <Field
          label={t("engine.transfers")}
          hint={t("engine.transfersHint")}
          keyboard="numeric"
          value={String(defaults.transfers ?? 4)}
          onChange={(v) => saveDefaults({ transfers: Number(v) || undefined })}
        />
        <Field
          label={t("edit.quietPeriod")}
          hint={t("edit.quietHint")}
          value={String(defaults.quietPeriod ?? "")}
          onChange={(quietPeriod) => saveDefaults({ quietPeriod })}
          placeholder="30s"
        />
      </Section>

      {/* What travels besides the file contents. Two switches that change what
          arrives at the other end rather than how fast. */}
      <Section title={t("settings.contents")} hue={2}>
        <Toggle
          label={t("edit.emptyDirs")}
          hint={t("edit.emptyDirsHint")}
          value={Boolean(defaults.emptyDirs)}
          onChange={(emptyDirs) => saveDefaults({ emptyDirs })}
        />
        <Toggle
          label={t("edit.metadata")}
          hint={t("edit.metadataHint")}
          value={Boolean(defaults.metadata)}
          onChange={(metadata) => saveDefaults({ metadata })}
        />
      </Section>

      {/* The brakes, and they get a card of their own because of what they are:
          the net that stops a run removing more than half of everything it
          knows about. Until now they were invisible on the phone entirely. */}
      <Section title={t("settings.safetyNet")} hue={3}>
        <Field
          label={t("engine.brakePercent")}
          hint={t("engine.brakePercentHint")}
          keyboard="numeric"
          value={String(defaults.brakePercent ?? 50)}
          onChange={(v) => saveDefaults({ brakePercent: clamp(v, 0, 100) })}
        />
        <Field
          label={t("engine.brakeFloor")}
          hint={t("engine.brakeFloorHint")}
          keyboard="numeric"
          value={String(defaults.brakeFloor ?? 10)}
          onChange={(v) => saveDefaults({ brakeFloor: clamp(v, 0, 100000) })}
        />
      </Section>

      {/* Power, and it is one card rather than a switch inside a bigger one
          because both answers are about the same resource: a phone syncing
          overnight is a phone spending its battery on it. Neither holds a run
          somebody started by hand - pressing the button is a decision. */}
      <Section title={t("sync.power")} hue={4}>
        <Toggle
          label={t("phone.charging")}
          hint={t("phone.chargingHint")}
          value={Boolean(policy?.onlyCharging)}
          onChange={(onlyCharging) => setConditions({ onlyCharging })}
        />
        {/* A number rather than a switch, because the useful answer is not
            "yes" but "below what". Zero is off, which is what an empty box
            gives, so the way to stop using it is to clear it rather than to
            find a second control. */}
        <Field
          label={t("phone.minBattery")}
          hint={t("phone.minBatteryHint")}
          keyboard="numeric"
          value={policy?.minBattery ? String(policy.minBattery) : ""}
          onChange={(v) => setConditions({ minBattery: clamp(v, 0, 95) ?? 0 })}
        />
      </Section>

      {/* The connection, in three questions that are genuinely different ones.
          They were one switch for a while and jdp was right to split them: "nur
          über WLAN" is about the transport, "kostenpflichtig" is about the
          bill, and a wifi network its owner marked metered fails the second
          while passing the first. */}
      <Section title={t("sync.network")} hue={5}>
        <Toggle
          label={t("phone.wifi")}
          hint={t("phone.wifiHint")}
          value={Boolean(policy?.onlyWifi)}
          onChange={(onlyWifi) => setConditions({ onlyWifi })}
        />
        <Toggle
          label={t("phone.metered")}
          hint={t("phone.meteredHint")}
          value={Boolean(policy?.notMetered)}
          onChange={(notMetered) => setConditions({ notMetered })}
        />
        <Toggle
          label={t("phone.roaming")}
          hint={t("phone.roamingHint")}
          value={Boolean(policy?.notRoaming)}
          onChange={(notRoaming) => setConditions({ notRoaming })}
        />
        {/* What the switches are DOING right now. A condition whose consequence
            is invisible is a condition somebody waits all evening for. It sits
            under the connection rather than under the power card because that
            is where four of the five reasons come from - and it names whichever
            one the engine is actually acting on. */}
        {held ? <Body>{held}</Body> : null}
      </Section>

      {/* What happens after a run fails, which until now was: try again at
          every turn of the clock, for ever. On a phone that clock turns every
          fifteen minutes, so a remote that was down for a night was asked
          about it ninety-six times. Both numbers matter - without the retries
          a hiccup at three in the morning costs the whole night, and without
          the limit nothing ever stops. */}
      <Section title={t("settings.retry")} hint={t("retry.hint")} hue={6}>
        <Field
          label={t("retry.attempts")}
          hint={t("retry.attemptsHint")}
          keyboard="numeric"
          value={retry.attempts === undefined ? "3" : String(retry.attempts)}
          onChange={(v) => saveRetry({ attempts: clamp(v, 0, 10) ?? 0 })}
        />
        {/* In MINUTES, as a number, rather than a well of four durations. The
            well needed a label per option, and "1 hours" is what a plural-free
            join gives in most of forty languages - a translation problem
            invented by the control rather than by the setting. */}
        <Field
          label={`${t("retry.wait")} (${t("schedule.unit.minute")})`}
          hint={t("retry.waitHint")}
          keyboard="numeric"
          value={String(waitMinutes(retry.wait))}
          onChange={(v) => saveRetry({ wait: `${clamp(v, 1, 1440) ?? 5}m` })}
        />
      </Section>

    </Page>
  );
}

/**
 * What the three modes do, as one bubble.
 *
 * Built from the existing per-mode hints rather than from a new string: those
 * are already translated into forty languages, and a fourth sentence saying the
 * same thing would be a fourth thing to keep in step with them.
 */
function modeHint(t: ReturnType<typeof useT>["t"]): string {
  return [
    `${t("mode.sync")}: ${t("mode.syncHint")}`,
    `${t("mode.mirror")}: ${t("mode.mirrorHint")}`,
    `${t("mode.move")}: ${t("mode.moveHint")}`,
    // A blank line between them, so three sentences read as three answers
    // rather than as one paragraph about syncing.
  ].join("\n\n");
}

/**
 * The stored wait, as whole minutes.
 *
 * The engine takes a Go duration because that is what everything else in the
 * file takes, and a screen that made somebody type "5m" would be asking them to
 * know that. Anything it cannot read comes back as the engine's own default
 * rather than as zero: an unreadable value means the built-in applies, and a
 * box showing 0 would claim a setting that is not in force.
 */
function waitMinutes(raw: unknown): number {
  const match = /^(\d+)(m|h)$/.exec(String(raw ?? ""));
  if (!match) return 5;
  const n = Number(match[1]);
  return match[2] === "h" ? n * 60 : n;
}

/**
 * A typed number, held inside the range the engine accepts.
 *
 * An empty box gives `undefined` rather than zero, which is the difference
 * between "unset, take the built-in" and "zero per cent", and on a brake that
 * difference is a run that stops at half against one that stops at nothing.
 */
function clamp(text: string, low: number, high: number): number | undefined {
  const value = Number(text.replace(/[^\d]/g, ""));
  if (!text.trim() || Number.isNaN(value)) return undefined;
  return Math.min(high, Math.max(low, value));
}
