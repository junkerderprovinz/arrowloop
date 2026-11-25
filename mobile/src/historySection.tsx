import { useRef, useState } from "react";
import { Alert } from "react-native";

import { api } from "./api";
import { NumberField } from "./fields";
import { afterSwitch, keepOf, keepSetting } from "./historyKeep";
import { useT } from "./i18n";
import { useEngineSettings } from "./settings";
import { Body, Button, Caption, Row, Section, Toggle } from "./ui";

/** How long the history keeps a run, and a way to drop the older ones now, as on the web's General tile. */
export function HistorySection({ hue }: { hue: number }) {
  const { t } = useT();
  const { settings, update, error } = useEngineSettings(true);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  // The days to go back to when Keep forever is switched off again.
  const before = useRef<number | null>(null);

  if (!settings) return null;
  const { days, forever } = keepOf(settings.historyKeep);

  const remove = () =>
    Alert.alert(t("history.deleteOld"), t("history.deleteOldQuestion", { days }), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("history.deleteOldButton"),
        onPress: () => {
          setBusy(true);
          api
            .pruneHistory()
            .then(
              ({ runs }) => setSaid(t("history.deletedOld", { count: runs })),
              (e: Error) => setSaid(e.message),
            )
            .finally(() => setBusy(false));
        },
      },
    ]);

  return (
    <Section title={t("nav.history")} hue={hue}>
      <Toggle
        label={t("history.keepForever")}
        hint={t("history.keepForeverHint")}
        value={forever}
        onChange={(on) => {
          if (on) before.current = days;
          void update({ historyKeep: afterSwitch(on, before.current) });
        }}
      />
      {/* Absent rather than dimmed while every run is kept, as on the web. */}
      {!forever && (
        <>
          <NumberField
            label={t("history.keep")}
            hint={t("history.keepHint")}
            value={String(days)}
            onChange={(typed) => {
              const next = Math.round(Number(typed));
              if (Number.isFinite(next)) void update({ historyKeep: keepSetting(Math.min(Math.max(next, 0), 36500)) });
            }}
          />
          <Row label={t("history.deleteOld")} hint={t("history.deleteOldHint", { days })} />
          <Button
            label={t("history.deleteOldButton")}
            labelKey="history.deleteOldButton"
            glyph="IconTrash"
            busy={busy}
            onPress={remove}
          />
          <Caption>{t("history.deleteOldStays")}</Caption>
        </>
      )}
      {said ? <Body>{said}</Body> : null}
      {error ? <Body>{error}</Body> : null}
    </Section>
  );
}
