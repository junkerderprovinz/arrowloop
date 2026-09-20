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
 * The defaults every job starts from, and the phone's run conditions. A job
 * that sets a value keeps it; every other job takes the value from here.
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

  /** Sends only the changed conditions; the bridge merges them with the rest. */
  const setConditions = (patch: Partial<DeviceConditions>) => {
    setPolicy((old) => (old ? { ...old, ...patch } : old));
    engine.setDevicePolicy(patch).then(refresh, () => refresh());
  };

  const retry = (settings?.retry ?? {}) as Record<string, unknown>;
  const saveRetry = (patch: Record<string, unknown>) =>
    update({ retry: { ...retry, ...patch } });

  const heldAt = heldKey(policy);
  const held = heldAt ? t(heldAt) : "";

  return (
    <Page>
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
        {/* Both ways has only one mode, so the selector goes inert on `sync`
            instead of vanishing and changing the card's shape. */}
        {(() => {
          const both = (defaults.direction ?? "both") === "both";
          return (
            <>
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
        <AxisLabel>{t("edit.schedule")}</AxisLabel>
        <Schedule
          value={String(defaults.schedule ?? "")}
          onChange={(schedule) => saveDefaults({ schedule })}
        />
      </Section>

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
        <Field
          label={t("retry.attempts")}
          hint={t("retry.attemptsHint")}
          keyboard="numeric"
          value={retry.attempts === undefined ? "3" : String(retry.attempts)}
          onChange={(v) => saveRetry({ attempts: clamp(v, 0, 10) ?? 0 })}
        />
        {/* Minutes as a number, which needs no plural forms in translation. */}
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
 * Explains all three modes in one bubble, built from the per-mode hints the
 * translations already carry.
 */
function modeHint(t: ReturnType<typeof useT>["t"]): string {
  return [
    `${t("mode.sync")}: ${t("mode.syncHint")}`,
    `${t("mode.mirror")}: ${t("mode.mirrorHint")}`,
    `${t("mode.move")}: ${t("mode.moveHint")}`,
  ].join("\n\n");
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
