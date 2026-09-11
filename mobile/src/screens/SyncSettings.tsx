import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { engine, type DevicePolicy } from "../engine";
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

  /** The two conditions, stored on the phone AND told to the engine at once:
   *  the engine is what holds a run back, and Kotlin is what watches the
   *  battery and the connection while the screen is off. */
  const setConditions = (patch: { onlyCharging?: boolean; onlyWifi?: boolean }) => {
    const next = {
      onlyCharging: patch.onlyCharging ?? Boolean(policy?.onlyCharging),
      onlyWifi: patch.onlyWifi ?? Boolean(policy?.onlyWifi),
    };
    setPolicy((old) => (old ? { ...old, ...next } : old));
    engine.setDevicePolicy(next.onlyCharging, next.onlyWifi).then(refresh, () => refresh());
  };

  const held = policy?.holding ?? "";

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

      {/* Autosync's own name for this group, and it is the better one: the two
          switches are not about WHEN a job is due, they are about whether the
          phone lets a due job go ahead. */}
      <Section title={t("phone.schedule")} hue={4}>
        <Toggle
          label={t("phone.charging")}
          hint={t("phone.chargingHint")}
          value={Boolean(policy?.onlyCharging)}
          onChange={(onlyCharging) => setConditions({ onlyCharging })}
        />
        <Toggle
          label={t("phone.wifi")}
          hint={t("phone.wifiHint")}
          value={Boolean(policy?.onlyWifi)}
          onChange={(onlyWifi) => setConditions({ onlyWifi })}
        />
        {/* What the switches are DOING right now. A condition whose consequence
            is invisible is a condition somebody waits all evening for. */}
        {held ? <Body>{held}</Body> : null}
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
