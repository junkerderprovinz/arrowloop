import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { heldKey } from "../deviceConditions";
import { engine, type DeviceConditions, type DevicePolicy } from "../engine";
import { useT } from "../i18n";
import { useEngineSettings } from "../settings";
import { useWaiting } from "../waiting";
import { Field, NumberField, Refusal } from "../fields";
import { Schedule } from "./JobEdit";
import { api, type JobConfig } from "../api";
import { ScheduleSentence } from "../inherit";
import { space } from "../theme";
import { AxisLabel, Body, Button, Caption, Choice, Page, Section, Toggle } from "../ui";
import { WaySwitch } from "../way";
import type { Notify } from "../../../web/src/lib/notify";
import {
  BRAKE_SETTINGS,
  SETTING_LABEL,
  SYNC_SETTINGS,
  describeOwn,
  exceptionsOf,
  inheritAll,
  type Exception,
} from "../../../web/src/lib/follows";
import { NotifySection } from "./NotifySettings";

/**
 * The defaults every job starts from, and the phone's run conditions. A job
 * that sets a value keeps it; every other job takes the value from here.
 */
export function SyncSettings() {
  const { t } = useT();
  const [policy, setPolicy] = useState<DevicePolicy | null>(null);

  const { settings, update } = useEngineSettings(true);
  const waiting = useWaiting();
  const defaults = (settings?.defaults ?? {}) as Record<string, unknown>;
  const saveDefaults = (patch: Record<string, unknown>) =>
    update({ defaults: { ...defaults, ...patch } });

  const refresh = useCallback(async () => {
    setPolicy(await engine.devicePolicy().catch(() => null));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Sends only the changed conditions; the bridge merges them with the rest. */
  const setConditions = (patch: Partial<DeviceConditions>) => {
    setPolicy((old) => (old ? { ...old, ...patch } : old));
    engine.setDevicePolicy(patch).then(refresh, () => refresh());
  };

  const anomalies = (settings?.anomalies ?? {}) as Record<string, unknown>;
  const saveAnomalies = (patch: Record<string, unknown>) =>
    update({ anomalies: { ...anomalies, ...patch } });

  const retry = (settings?.retry ?? {}) as Record<string, unknown>;
  const saveRetry = (patch: Record<string, unknown>) =>
    update({ retry: { ...retry, ...patch } });

  const heldAt = heldKey(policy);
  const held = heldAt ? t(heldAt) : "";

  return (
    <Page>
      <Section title={t("engine.defaults")} hint={t("defaults.followHint")} hue={0}>
        <AxisLabel>{t("direction.label")}</AxisLabel>
        {/* No job is in sight here, so the sides go by what the job form
            calls them while they are empty. */}
        <WaySwitch
          value={defaults.direction as string | undefined}
          upper={t("side.onDevice")}
          lower={t("side.target")}
          onChange={(direction) =>
            saveDefaults({ direction, mode: direction === "both" ? "sync" : defaults.mode })
          }
        />
        {/* Both ways has only one mode, so the selector goes inert on `sync`
            instead of vanishing and changing the card's shape. */}
        {(() => {
          const both = (defaults.direction ?? "both") === "both";
          return (
            <>
              <AxisLabel hint={both ? t("mode.onlyOneWay") : undefined}>
                {t("mode.label")}
              </AxisLabel>
              <Choice
                hue={1}
                disabled={both}
                value={both ? "sync" : String(defaults.mode ?? "sync")}
                onChange={(mode) => saveDefaults({ mode })}
                options={[
                  { value: "sync", label: t("mode.sync"), hint: t("mode.syncHint") },
                  { value: "mirror", label: t("mode.mirror"), hint: t("mode.mirrorHint") },
                  { value: "move", label: t("mode.move"), hint: t("mode.moveHint") },
                ]}
              />
            </>
          );
        })()}
        <AxisLabel>{t("edit.schedule")}</AxisLabel>
        <ScheduleSentence label={t("edit.schedule")} value={String(defaults.schedule ?? "")}>
          <Schedule value={String(defaults.schedule ?? "")} onChange={(schedule) => saveDefaults({ schedule })} />
        </ScheduleSentence>
      </Section>

      <Section title={t("settings.transfer")} hue={1}>
        <NumberField
          label={t("engine.transfers")}
          hint={t("engine.transfersHint")}
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

      <Section title={t("settings.safetyNet")} hue={3}>
        <NumberField
          label={t("engine.brakePercent")}
          hint={t("engine.brakePercentHint")}
          value={String(defaults.brakePercent ?? 50)}
          onChange={(v) => saveDefaults({ brakePercent: clamp(v, 0, 100) })}
        />
        <NumberField
          label={t("engine.changePercent")}
          hint={t("engine.changePercentHint")}
          value={String(defaults.changePercent ?? 50)}
          onChange={(v) => saveDefaults({ changePercent: clamp(v, 0, 100) })}
        />
        <NumberField
          label={t("engine.brakeFloor")}
          hint={t("engine.brakeFloorHint")}
          value={String(defaults.brakeFloor ?? 10)}
          onChange={(v) => saveDefaults({ brakeFloor: clamp(v, 0, 100000) })}
        />
      </Section>

      <ExceptionsSection hue={4} />

      {/* The two notes that hold nothing, and who hears about a finding. Off,
          the notes and their screen go; a brake still holds a job, and a
          held job is still told. */}
      <Section title={t("nav.anomalies")} hue={4}>
        <Toggle
          label={t("nav.anomalies")}
          hint={t("anomaly.moduleHint")}
          value={anomalies.off !== true}
          onChange={(on) => void saveAnomalies({ off: !on }).then(waiting.refresh)}
        />
        {anomalies.off !== true ? (
          <>
            <NumberField
              label={t("anomaly.failingAfter")}
              hint={t("anomaly.failingAfterHint")}
              value={String(anomalies.failingAfter ?? 3)}
              onChange={(v) => saveAnomalies({ failingAfter: clamp(v, 0, 50) })}
            />
            <NumberField
              label={`${t("anomaly.overdueDays")} (${t("anomaly.daysLate")})`}
              hint={t("anomaly.overdueDaysHint")}
              value={String(anomalies.overdueDays ?? 2)}
              onChange={(v) => saveAnomalies({ overdueDays: clamp(v, 0, 365) })}
            />
            <Toggle
              label={t("anomaly.unusual")}
              hint={t("anomaly.unusualHint")}
              value={anomalies.unusual !== false}
              onChange={(unusual) => saveAnomalies({ unusual })}
            />
          </>
        ) : null}
        <Toggle
          label={t("anomaly.notifyHeld")}
          hint={t("anomaly.notifyHeldHint")}
          value={anomalies.notifyHeld !== false}
          onChange={(notifyHeld) => saveAnomalies({ notifyHeld })}
        />
        {anomalies.off !== true ? (
          <Toggle
            label={t("anomaly.notifyNotes")}
            hint={t("anomaly.notifyNotesHint")}
            value={anomalies.notifyNotes === true}
            onChange={(notifyNotes) => saveAnomalies({ notifyNotes })}
          />
        ) : null}
      </Section>

      <NotifySection
        notify={(settings?.notify ?? {}) as Notify}
        save={(notify) => void update({ notify })}
        hue={5}
      />

      {/* Neither power condition holds a run started by hand. */}
      <Section title={t("sync.power")} hue={4}>
        <Toggle
          label={t("phone.charging")}
          hint={t("phone.chargingHint")}
          value={Boolean(policy?.onlyCharging)}
          onChange={(onlyCharging) => setConditions({ onlyCharging })}
        />
        {/* An empty box is zero, which turns the floor off. */}
        <Field
          label={t("phone.minBattery")}
          hint={t("phone.minBatteryHint")}
          keyboard="numeric"
          short
          value={policy?.minBattery ? String(policy.minBattery) : ""}
          onChange={(v) => setConditions({ minBattery: clamp(v, 0, 95) ?? 0 })}
        />
      </Section>

      {/* Wifi and metered are separate questions: a wifi network marked
          metered passes the first and fails the second. */}
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
        {/* The condition the engine is holding runs on right now, if any. */}
        {held ? <Body>{held}</Body> : null}
      </Section>

      <Section title={t("settings.retry")} hint={t("retry.hint")} hue={6}>
        <NumberField
          label={t("retry.attempts")}
          hint={t("retry.attemptsHint")}
          value={retry.attempts === undefined ? "3" : String(retry.attempts)}
          onChange={(v) => saveRetry({ attempts: clamp(v, 0, 10) ?? 0 })}
        />
        {/* Minutes as a number, which needs no plural forms in translation. */}
        <NumberField
          label={`${t("retry.wait")} (${t("schedule.unit.minute")})`}
          hint={t("retry.waitHint")}
          value={String(waitMinutes(retry.wait))}
          onChange={(v) => saveRetry({ wait: `${clamp(v, 1, 1440) ?? 5}m` })}
        />
      </Section>

    </Page>
  );
}

/**
 * The jobs with a value of their own for a default on this screen, each with
 * those values and Use the default. It is left out while every job follows
 * the defaults.
 */
function ExceptionsSection({ hue }: { hue: number }) {
  const { t } = useT();
  const [jobs, setJobs] = useState<JobConfig[]>([]);
  const [failed, setFailed] = useState<{ name: string; reason: string; shake: number } | null>(null);

  useEffect(() => {
    api.config().then(
      (c) => setJobs(c.jobs),
      () => setJobs([]),
    );
  }, []);

  const list = exceptionsOf(jobs, [...SYNC_SETTINGS, ...BRAKE_SETTINGS]);
  if (list.length === 0) return null;

  // The file is read again first, so a change made elsewhere since this
  // screen loaded is kept.
  const inherit = async (exception: Exception) => {
    try {
      const current = await api.config();
      const next = current.jobs.map((j) => (j.name === exception.name ? { ...j, ...inheritAll(exception.own) } : j));
      await api.writeConfig({ ...current, jobs: next });
      setJobs(next);
      setFailed(null);
    } catch (e) {
      setFailed((was) => ({ name: exception.name, reason: (e as Error).message, shake: (was?.shake ?? 0) + 1 }));
    }
  };

  const ask = (exception: Exception) =>
    Alert.alert(
      t("defaults.askTitle"),
      t("defaults.askAll", {
        name: exception.name,
        list: exception.own.map((setting) => t(SETTING_LABEL[setting])).join(", "),
      }),
      [
        { text: t("confirm.cancel"), style: "cancel" },
        { text: t("defaults.useDefault"), onPress: () => void inherit(exception) },
      ],
    );

  return (
    <Section title={t("defaults.exceptions")} hint={t("defaults.exceptionsHint")} hue={hue}>
      {list.map((exception) => {
        const job = jobs.find((j) => j.name === exception.name) ?? {};
        const mine = failed?.name === exception.name ? failed : null;
        return (
          <View key={exception.name} style={styles.exception}>
            <Body>{exception.name}</Body>
            <Caption>{exception.own.map((setting) => describeOwn(job, setting, t)).join(" · ")}</Caption>
            {mine ? <Refusal text={mine.reason} /> : null}
            <View style={styles.end}>
              <Button
                label={t("defaults.useDefault")}
                labelKey="defaults.useDefault"
                wide={false}
                shake={mine?.shake}
                onPress={() => ask(exception)}
              />
            </View>
          </View>
        );
      })}
    </Section>
  );
}

/**
 * Converts the stored Go duration to whole minutes. An unreadable value shows
 * the engine's default of 5, which is what applies.
 */
function waitMinutes(raw: unknown): number {
  const match = /^(\d+)(m|h)$/.exec(String(raw ?? ""));
  if (!match) return 5;
  const n = Number(match[1]);
  return match[2] === "h" ? n * 60 : n;
}

/**
 * Clamps a typed number to the range the engine accepts. An empty box gives
 * undefined, meaning the built-in default, which is not the same as zero.
 */
function clamp(text: string, low: number, high: number): number | undefined {
  const value = Number(text.replace(/[^\d]/g, ""));
  if (!text.trim() || Number.isNaN(value)) return undefined;
  return Math.min(high, Math.max(low, value));
}

const styles = StyleSheet.create({
  exception: { gap: space.xs },
  end: { flexDirection: "row", justifyContent: "flex-end" },
});
