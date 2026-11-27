import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  joinUpstreams,
  joinWrapped,
  splitUpstreams,
  splitWrapped,
  targetChoiceLabel,
  type KnownTarget,
  type Upstream,
} from "../../web/src/lib/wrappedTarget";
import { ChoiceRow } from "./choiceRow";
import { engine } from "./engine";
import { Field } from "./fields";
import { useT } from "./i18n";
import { space, text } from "./theme";
import { AxisLabel, Button, InfoBubble, useTheme } from "./ui";

function targetOptions(targets: KnownTarget[], here: string) {
  return [{ value: "", label: here }, ...targets.map((t) => ({ value: t.name, label: targetChoiceLabel(t) }))];
}

/** The remote setting of a wrapping target: a saved target picked by its name, and a folder in it. */
export function WrapField({
  label,
  hint,
  value,
  targets,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  targets: KnownTarget[];
  onChange: (next: string) => void;
}) {
  const { t } = useT();
  const wrapped = splitWrapped(value, targets);
  return (
    <View style={styles.group}>
      <ChoiceRow
        label={label}
        hint={hint}
        value={wrapped.target}
        onChange={(target) => onChange(joinWrapped({ ...wrapped, target }))}
        options={targetOptions(targets, t("targets.wrap.here"))}
      />
      <Field
        label={t("targets.wrap.folder")}
        hint={t("targets.wrap.folderHint")}
        value={wrapped.folder}
        onChange={(folder) => onChange(joinWrapped({ ...wrapped, folder }))}
        placeholder={wrapped.target ? "folder" : "/path"}
        hidePlaceholderOnFocus
      />
    </View>
  );
}

/** The upstreams of a union or combine, one block per target joined. */
export function UpstreamsField({
  label,
  hint,
  value,
  targets,
  combine,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  targets: KnownTarget[];
  combine: boolean;
  onChange: (next: string) => void;
}) {
  const { t } = useT();
  // A row just added is empty and would not survive a round trip through the setting.
  const [rows, setRows] = useState<Upstream[]>(() => {
    const read = splitUpstreams(value, targets, combine);
    return read.length > 0 ? read : [blank(combine)];
  });
  const change = (next: Upstream[]) => {
    setRows(next);
    onChange(joinUpstreams(next, combine));
  };
  const patch = (at: number, part: Partial<Upstream>) => change(rows.map((r, i) => (i === at ? { ...r, ...part } : r)));
  const options = targetOptions(targets, t("targets.wrap.here"));

  return (
    <View style={styles.group}>
      <AxisLabel hint={hint}>{label}</AxisLabel>
      {rows.map((row, i) => (
        <View key={i} style={styles.group}>
          <ChoiceRow
            label={t("targets.wrap.joined")}
            value={row.target}
            onChange={(target) => patch(i, { target })}
            options={options}
          />
          {combine ? (
            <Field label={t("targets.wrap.dir")} value={row.dir ?? ""} onChange={(dir) => patch(i, { dir })} />
          ) : null}
          <Field
            label={t("targets.wrap.folder")}
            value={row.folder}
            onChange={(folder) => patch(i, { folder })}
            placeholder={row.target ? "folder" : "/path"}
            hidePlaceholderOnFocus
          />
          {rows.length > 1 ? (
            <Button
              label={t("targets.wrap.remove")}
              labelKey="targets.wrap.remove"
              onPress={() => change(rows.filter((_, j) => j !== i))}
            />
          ) : null}
        </View>
      ))}
      <Button
        label={t("targets.wrap.add")}
        labelKey="targets.wrap.add"
        onPress={() => setRows([...rows, blank(combine)])}
      />
    </View>
  );
}

function blank(combine: boolean): Upstream {
  return combine ? { dir: "", target: "", folder: "", mode: "" } : { target: "", folder: "", mode: "" };
}

/** A saved target's id, which jobs, wrapping targets and rclone's own command line write before the colon. */
export function TargetIdRow({ id }: { id: string }) {
  const { t } = useT();
  const { p } = useTheme();
  const [copied, setCopied] = useState(0);
  return (
    <View style={styles.row}>
      <View style={styles.name}>
        <Text style={[styles.body, { color: p.text }]}>{t("targets.remoteId")}</Text>
        <InfoBubble tip={t("targets.remoteIdHint")} />
      </View>
      <Text selectable style={[styles.mono, { color: p.text }]}>
        {id}
      </Text>
      <Button
        label={copied > 0 ? t("targets.copied") : t("targets.copyId")}
        labelKey="targets.copyId"
        glyphOnly
        confirm={copied}
        onPress={() => void engine.copy(id).then(() => setCopied((n) => n + 1), () => {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  name: { flexDirection: "row", alignItems: "center", gap: space.xs, flexGrow: 1 },
  body: { fontSize: text.body, flexShrink: 1 },
  mono: { fontFamily: "monospace", fontSize: text.body, flexShrink: 1 },
});
