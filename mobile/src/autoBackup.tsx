import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";

import { api, type AutoBackups } from "./api";
import { Field, NumberField } from "./fields";
import { useT } from "./i18n";
import { useEngineSettings } from "./settings";
import { Body, Button, Pair, Section, Toggle } from "./ui";

/** The engine's autoBackup setting. An undefined field keeps the engine's own value. */
interface AutoBackup {
  off?: boolean;
  everyDays?: number;
  keep?: number;
  folder?: string;
}

/**
 * The copies of the setup the engine keeps on its own, as on the web's
 * General tile, and the newest of them put back through the engine's import.
 */
export function AutoBackupSection({ hue }: { hue: number }) {
  const { t, lang } = useT();
  const { settings, update, error } = useEngineSettings(true);
  const [state, setState] = useState<AutoBackups | null>(null);
  // The folder is saved when the field is left, since the engine checks it
  // can write there and a half-typed path would be refused on the way.
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [restored, setRestored] = useState(0);

  const auto = (settings?.autoBackup ?? {}) as AutoBackup;
  const on = !auto.off;
  const set = (next: AutoBackup) => update({ autoBackup: { ...auto, ...next } });

  const read = useCallback(() => {
    api.autoBackups().then(setState, () => setState(null));
  }, []);
  useEffect(read, [read, settings]);

  const latest = state?.files[0];

  const restore = async (name: string) => {
    setBusy(true);
    setSaid("");
    try {
      await api.restoreAutoBackup(name);
      setSaid(t("settings.imported"));
      setRestored((n) => n + 1);
      read();
    } catch (e) {
      setSaid((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Restoring replaces every job, so it asks first, with the web's sentence.
  const confirm = (name: string, made: string) =>
    Alert.alert(
      t("autoBackup.restore"),
      on
        ? t("autoBackup.confirm", { when: new Date(made).toLocaleString(lang) })
        : t("backup.confirm", { file: name }),
      [
        { text: t("confirm.cancel"), style: "cancel" },
        { text: t("autoBackup.restore"), onPress: () => void restore(name) },
      ],
    );

  if (!settings) return null;

  return (
    <Section title={t("autoBackup.title")} hint={t("autoBackup.hint")} hue={hue}>
      <Toggle label={t("autoBackup.on")} value={on} onChange={(next) => set({ off: !next })} />
      {on && (
        <>
          <NumberField
            label={t("autoBackup.everyDays")}
            hint={t("autoBackup.everyDaysHint")}
            value={String(auto.everyDays ?? 1)}
            onChange={(v) => set({ everyDays: Number(v) || undefined })}
          />
          <NumberField
            label={t("autoBackup.keep")}
            hint={t("autoBackup.keepHint")}
            value={String(auto.keep ?? 7)}
            onChange={(v) => set({ keep: Number(v) || undefined })}
          />
          <Field
            label={t("autoBackup.folder")}
            hint={t("autoBackup.folderPhoneHint")}
            value={folder ?? auto.folder ?? ""}
            onChange={setFolder}
            onBlur={() => {
              if (folder !== null && folder !== (auto.folder ?? "")) set({ folder });
              setFolder(null);
            }}
            placeholder={state?.folder}
          />
        </>
      )}
      <Pair
        label={t("autoBackup.latest")}
        value={latest ? new Date(latest.made).toLocaleString(lang) : t("autoBackup.none")}
      />
      {latest ? (
        <Button
          label={t("autoBackup.restore")}
          labelKey="autoBackup.restore"
          wide={false}
          busy={busy}
          confirm={restored}
          onPress={() => confirm(latest.name, latest.made)}
        />
      ) : null}
      {state?.last?.error ? <Body>{t("autoBackup.failed", { error: state.last.error })}</Body> : null}
      {error ? <Body>{error}</Body> : null}
      {said ? <Body>{said}</Body> : null}
    </Section>
  );
}
