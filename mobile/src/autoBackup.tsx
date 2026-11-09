import { useCallback, useEffect, useState } from "react";

import { api, type AutoBackups } from "./api";
import { Field, NumberField, TimeField } from "./fields";
import { FolderPicker } from "./FolderPicker";
import { Glyph } from "./glyphs";
import { useT } from "./i18n";
import { useEngineSettings } from "./settings";
import { Body, Button, Pair, Section, Toggle } from "./ui";

/** The engine's autoBackup setting. An undefined field keeps the engine's own value. */
interface AutoBackup {
  off?: boolean;
  everyDays?: number;
  /** HH:MM on the engine's clock. */
  at?: string;
  keep?: number;
  folder?: string;
}

/** The copies of the setup the engine keeps on its own, as on the web's General tile. */
export function AutoBackupSection({ hue }: { hue: number }) {
  const { t, lang } = useT();
  const { settings, update, error } = useEngineSettings(true);
  const [state, setState] = useState<AutoBackups | null>(null);
  // The folder is saved when the field is left, since the engine checks it
  // can write there and a half-typed path would be refused on the way.
  const [folder, setFolder] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const auto = (settings?.autoBackup ?? {}) as AutoBackup;
  const on = !auto.off;
  const set = (next: AutoBackup) => update({ autoBackup: { ...auto, ...next } });

  const read = useCallback(() => {
    api.autoBackups().then(setState, () => setState(null));
  }, []);
  useEffect(read, [read, settings]);

  const latest = state?.files[0];

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
          <TimeField
            label={t("autoBackup.at")}
            hint={t("autoBackup.atHint")}
            value={auto.at ?? "03:00"}
            onChange={(at) => set({ at })}
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
          <Button
            label={t("pick.title")}
            labelKey="pick.title"
            mark={(ink) => <Glyph name="IconFolder" color={ink} />}
            onPress={() => setPicking(true)}
          />
          <FolderPicker
            visible={picking}
            start={auto.folder || state?.folder}
            onPick={(path) => {
              set({ folder: path });
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        </>
      )}
      <Pair
        label={t("autoBackup.latest")}
        value={latest ? new Date(latest.made).toLocaleString(lang) : t("autoBackup.none")}
      />
      {state?.last?.error ? <Body>{t("autoBackup.failed", { error: state.last.error })}</Body> : null}
      {error ? <Body>{error}</Body> : null}
    </Section>
  );
}
