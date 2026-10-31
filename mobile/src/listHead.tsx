import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Glyph } from "./glyphs";
import { useT, type T } from "./i18n";
import { space, text, TOUCH } from "./theme";
import { Badge, Button, Press, Sheet, useTheme } from "./ui";

// GlimStone's list on the phone. The web's head sorts on a click, filters
// through its ▾ and searches when somebody types; a phone has no keys to type
// into a list and no pointer to hover, so a tap on a head sorts, its ▾ opens
// the filter, and a long press on a head offers both orders, the filter and
// the search, with the line that says so.

export type SortDir = "asc" | "desc";

export interface Head {
  id: string;
  label: string;
  /** The two orders a long press offers, named the way this column reads. */
  orders?: { asc: string; desc: string };
  /** Opens the filter sheet, and whether the filter narrows the list now. */
  filter?: { active: boolean; open: () => void };
}

const KEY = "arrowloop.list.tips";

/** Whether this is the screen's first visit; the line then shows by itself, once. */
function useFirstVisit(page: string): [boolean, () => void] {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        const pages = raw ? (JSON.parse(raw) as unknown) : [];
        const seen = Array.isArray(pages) ? pages.filter((p): p is string => typeof p === "string") : [];
        if (seen.includes(page) || !live) return;
        setShown(true);
        return AsyncStorage.setItem(KEY, JSON.stringify([...seen, page]));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [page]);
  return [shown, () => setShown(false)];
}

function tipText(t: T, heads: Head[]): string {
  return [
    ...(heads.some((h) => h.orders) ? [t("list.tip.sort")] : []),
    ...(heads.some((h) => h.filter) ? [t("list.tip.filter")] : []),
    t("list.tip.hold"),
  ].join(" ");
}

export function ListHead({
  heads,
  sort,
  onSort,
  page,
  onSearch,
}: {
  heads: Head[];
  sort: { by: string; dir: SortDir };
  onSort: (by: string, dir: SortDir) => void;
  page: string;
  onSearch: () => void;
}) {
  const { t } = useT();
  const { p, accent } = useTheme();
  const [tip, closeTip] = useFirstVisit(page);
  const [held, setHeld] = useState<Head | null>(null);

  const sortBy = (head: Head, dir?: SortDir) => {
    if (!head.orders) return;
    onSort(head.id, dir ?? (sort.by === head.id && sort.dir === "asc" ? "desc" : "asc"));
    closeTip();
  };

  return (
    <View style={styles.wrap}>
      <View style={[styles.row, { borderBottomColor: p.border }]} accessibilityRole="header">
        {heads.map((head) => {
          const on = sort.by === head.id;
          const active = !!head.filter?.active;
          return (
            <View key={head.id} style={styles.head}>
              <Press
                accessibilityRole="button"
                accessibilityLabel={head.label}
                onPress={() => (head.orders ? sortBy(head) : head.filter?.open())}
                onLongPress={() => setHeld(head)}
                style={styles.name}
              >
                <Text numberOfLines={1} style={[styles.label, { color: on || active ? p.text : p.textMuted }]}>
                  {head.label}
                </Text>
                {on && head.orders ? (
                  <Glyph name={sort.dir === "asc" ? "IconMoveUp" : "IconMoveDown"} color={p.text} size={11} />
                ) : null}
              </Press>
              {head.filter ? (
                <Press
                  accessibilityRole="button"
                  accessibilityLabel={t("list.filterBy", { name: head.label })}
                  onPress={() => {
                    head.filter?.open();
                    closeTip();
                  }}
                  hitSlop={8}
                  style={styles.caret}
                >
                  <Glyph name="IconExpand" color={active ? p.text : p.textMuted} size={11} />
                  {active ? <View style={[styles.dot, { backgroundColor: accent }]} /> : null}
                </Press>
              ) : null}
            </View>
          );
        })}
      </View>
      {tip || held ? (
        <View style={styles.tip}>
          <Text style={[styles.tipText, { color: p.textSub }]}>{tipText(t, heads)}</Text>
          {tip ? (
            <Press accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={closeTip} hitSlop={8}>
              <Glyph name="IconClose" color={p.textSub} size={12} />
            </Press>
          ) : null}
        </View>
      ) : null}

      <Sheet open={held !== null} title={held?.label ?? ""} onClose={() => setHeld(null)}>
        {held?.orders
          ? (["asc", "desc"] as const).map((dir) => (
              <Option
                key={dir}
                label={held.orders![dir]}
                glyph={dir === "asc" ? "IconMoveUp" : "IconMoveDown"}
                on={sort.by === held.id && sort.dir === dir}
                onPress={() => {
                  sortBy(held, dir);
                  setHeld(null);
                }}
              />
            ))
          : null}
        {held?.filter ? (
          <Option
            label={t("list.filter")}
            glyph="IconFilter"
            onPress={() => {
              held.filter?.open();
              setHeld(null);
            }}
          />
        ) : null}
        <Option
          label={t("list.search")}
          glyph="IconSearch"
          onPress={() => {
            onSearch();
            setHeld(null);
          }}
        />
      </Sheet>
    </View>
  );
}

/** One choice in the sheet a long press opens. */
function Option({ label, glyph, on, onPress }: { label: string; glyph: string; on?: boolean; onPress: () => void }) {
  const { p, corners } = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      onPress={onPress}
      style={[styles.option, { backgroundColor: on ? p.surface2 : "transparent", ...corners.control }]}
    >
      <Glyph name={glyph} color={p.textSub} size={16} />
      <Text style={[styles.optionText, { color: p.text }]}>{label}</Text>
      {on ? <Glyph name="IconCheck" color={p.text} size={16} /> : null}
    </Press>
  );
}

/**
 * The list's search, at the top of its card once the long press asked for it.
 * Its cross empties and closes it; a field that holds text stays.
 */
export function ListSearch({
  open,
  value,
  onChange,
  onClose,
  placeholder,
}: {
  open: boolean;
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
  placeholder: string;
}) {
  const { t } = useT();
  const { p, corners } = useTheme();
  if (!open && value === "") return null;
  return (
    <View style={styles.search}>
      <TextInput
        value={value}
        onChangeText={onChange}
        autoFocus
        placeholder={placeholder}
        placeholderTextColor={p.textMuted}
        accessibilityLabel={t("list.search")}
        style={[styles.field, { backgroundColor: p.surface2, color: p.text, ...corners.control }]}
      />
      <Button
        label={t("common.close")}
        labelKey="common.close"
        wide={false}
        onPress={() => {
          onChange("");
          onClose();
        }}
      />
    </View>
  );
}

/** What narrows the list, in words, with the one tap that shows everything again. */
export function Narrowed({ what, onClear }: { what: string[]; onClear: () => void }): ReactNode {
  const { t } = useT();
  const { p } = useTheme();
  if (what.length === 0) return null;
  return (
    <View style={styles.narrowed}>
      <Badge label={t("list.filtered")} tone="accent" />
      <Text style={[styles.narrowedText, { color: p.textSub }]}>{what.join(" · ")}</Text>
      <Button label={t("list.showAll")} labelKey="list.showAll" wide={false} onPress={onClear} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingBottom: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: TOUCH, flexShrink: 1 },
  name: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: TOUCH, flexShrink: 1 },
  label: { fontSize: text.meta, fontWeight: "600" },
  caret: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 0, right: 0, width: 7, height: 7, borderRadius: 4 },
  tip: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs },
  tipText: { flex: 1, fontSize: text.meta },
  option: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH, paddingHorizontal: space.md },
  optionText: { flex: 1, fontSize: text.body },
  search: { flexDirection: "row", alignItems: "stretch", gap: space.sm, paddingTop: space.sm },
  field: { flex: 1, minHeight: TOUCH, paddingHorizontal: space.md, fontSize: text.body },
  narrowed: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  narrowedText: { flex: 1, minWidth: 120, fontSize: text.subline },
});
