import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { api, type ConnectInfo, type RelayConfig, type RelayMode } from "../api";
import { QR } from "../donate";
import { engine } from "../engine";
import { Field, Refusal } from "../fields";
import { Glyph } from "../glyphs";
import { useT } from "../i18n";
import type { MoreStack, Nav } from "../nav";
import { OtherInstances } from "../otherInstances";
import { kindName, pairStage, refusalText, seenAt } from "../pairing";
import { checkPhrase, PHRASE_WORDS } from "../phraseWords";
import { setAppearance, useAppearance } from "../settings";
import { contrastOn, softOn, space, text, TOUCH } from "../theme";
import { AxisLabel, Body, Button, Caption, Choice, InfoBubble, Page, Press, Section, Toggle, useTheme } from "../ui";

// How often the screen asks again who is there. Members come and go with the
// relay connection, which nothing pushes here, and asking is also what lets
// two instances meet and pin each other's key.
const REFRESH_MS = 10_000;

// What the engine lets an announce carry.
const MAX_NAME = 64;

/**
 * Pairing, as on the web's tile: three steps that explain it, the twelve
 * words, who came with them, and the relay that carries the rest. The phone's
 * own engine does the pairing, and this screen only asks it.
 */
export function Pairing() {
  const { t } = useT();
  const [group, setGroup] = useState<ConnectInfo | null>(null);
  const [relay, setRelay] = useState<RelayConfig | null>(null);
  const [error, setError] = useState(false);
  // Counts the reads and the answers the cards hand up, so a read that was out
  // while a newer answer came back cannot put back the state from before.
  const asked = useRef(0);

  const load = useCallback(() => {
    const read = ++asked.current;
    Promise.all([api.connect(), api.relay()]).then(
      ([g, r]) => {
        if (read !== asked.current) return;
        setGroup(g);
        setRelay(r);
        setError(false);
      },
      () => read === asked.current && setError(true),
    );
  }, []);

  const takeGroup = useCallback((g: ConnectInfo) => {
    asked.current++;
    setGroup(g);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, REFRESH_MS);
      return () => clearInterval(id);
    }, [load]),
  );

  return (
    <Page>
      <Steps />
      {error ? (
        <Section title={t("settings.pairing")} hue={1}>
          <Refusal text={t("pairing.loadError")} />
        </Section>
      ) : null}
      {group ? <PhraseCard group={group} onGroup={takeGroup} onRefresh={load} /> : null}
      {group?.active ? <GroupCard group={group} onGroup={takeGroup} onRefresh={load} /> : null}
      <InstancesCard />
      {group && relay ? (
        <RelayCard
          group={group}
          relay={relay}
          onRelay={(r) => {
            setRelay(r);
            load();
          }}
        />
      ) : null}
    </Page>
  );
}

/**
 * Gives the phone the name the handset goes by, once, where the engine would
 * otherwise announce it as Android's host name, which is "localhost".
 */
async function nameOnce(info: ConnectInfo): Promise<ConnectInfo> {
  const device = Constants.deviceName?.trim().slice(0, MAX_NAME);
  if ((info.name && info.name !== "localhost") || !device) return info;
  try {
    return await api.renameInstance(device);
  } catch {
    return info;
  }
}

/**
 * The Instances page on this screen, as on the web's tile: the switch that
 * puts it in the More sheet, and under it the page whole while it is not there.
 */
function InstancesCard() {
  const { t } = useT();
  const nav = useNavigation<Nav<MoreStack>>();
  const pinned = useAppearance().instancesInMore;
  return (
    <>
      <Section title={t("nav.instances")} hint={t("instances.hint")} hue={3}>
        <Toggle
          label={t("settings.showInMore")}
          hint={t("settings.showInMoreHint")}
          value={pinned}
          onChange={(on) => setAppearance({ instancesInMore: on })}
        />
        {pinned ? (
          <View style={styles.actions}>
            <Button label={t("settings.open")} labelKey="settings.open" onPress={() => nav.navigate("Instances")} />
          </View>
        ) : null}
      </Section>
      {pinned ? null : <OtherInstances firstHue={4} />}
    </>
  );
}

/** Three numbered steps before any button does anything. */
function Steps() {
  const { t } = useT();
  const { p, corners, accent } = useTheme();
  const steps: { title: string; body: ReactNode }[] = [
    { title: t("pairing.step1Title"), body: t("pairing.step1Body") },
    { title: t("pairing.step2Title"), body: emphasize(t("pairing.step2Body", { button: MARK }), t("pairing.enter"), p.text) },
    { title: t("pairing.step3Title"), body: t("pairing.step3Body") },
  ];
  return (
    <Section title={t("pairing.howTitle")} hue={0}>
      {steps.map((s, i) => (
        <View key={i} style={[styles.well, { backgroundColor: p.surface2, ...corners.control }]}>
          <View style={styles.line}>
            <View style={[styles.number, { backgroundColor: accent, ...corners.pill }]}>
              <Text style={[styles.numberText, { color: contrastOn(accent) }]}>{i + 1}</Text>
            </View>
            <Text style={[styles.strong, { color: p.text }]}>{s.title}</Text>
          </View>
          <Body>{s.body}</Body>
        </View>
      ))}
    </Section>
  );
}

// Stands where a sentence names a button, so the name can go in bold.
const MARK = "\u2063";

/** The sentence with its MARK replaced by a bold `what`. */
function emphasize(said: string, what: string, ink: string): ReactNode {
  const [before, after = ""] = said.split(MARK);
  return (
    <>
      {before}
      <Text style={[styles.strong, { color: ink }]}>{what}</Text>
      {after}
    </>
  );
}

/**
 * The twelve words. Outside a group it offers to make a phrase or to enter
 * one. A phrase made here stays on the card with the way to the button on the
 * other instance. Inside a group it shows the words again and leaves.
 */
function PhraseCard({
  group,
  onGroup,
  onRefresh,
}: {
  group: ConnectInfo;
  onGroup: (g: ConnectInfo) => void;
  onRefresh: () => void;
}) {
  const { t } = useT();
  const [shown, setShown] = useState<{ phrase: string; code: string } | null>(null);
  const [createdHere, setCreatedHere] = useState(false);
  const [entering, setEntering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);

  // Words shown here belong to the group they were shown for. The desktop or
  // the web can leave it, and the poll is the only sign.
  const wasActive = useRef(group.active);
  useEffect(() => {
    if (wasActive.current && !group.active) {
      setShown(null);
      setCreatedHere(false);
      setSaid(null);
    }
    wasActive.current = group.active;
  }, [group.active]);

  const stage = pairStage(group, createdHere);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setSaid(null);
    try {
      await action();
    } catch (e) {
      setSaid({ text: refusalText(t, e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run(async () => {
      const made = await api.makePhrase();
      setShown({ phrase: made.phrase, code: made.code });
      setCopied(false);
      setCreatedHere(true);
      onGroup(await nameOnce(made.info));
    });

  const reveal = () =>
    run(async () => {
      setShown(await api.revealPhrase());
      setCopied(false);
    });

  const leave = () =>
    Alert.alert(t("pairing.leaveTitle"), t("pairing.leaveStakes"), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("pairing.leave"),
        onPress: () =>
          void run(async () => {
            await api.leaveGroup();
            setShown(null);
            setCreatedHere(false);
            onRefresh();
          }),
      },
    ]);

  const copy = (phrase: string) =>
    void engine.copy(phrase).then(
      () => setCopied(true),
      () => {},
    );

  let body: ReactNode;
  if (entering) {
    body = (
      <PhraseEntry
        onBack={() => setEntering(false)}
        onPaired={(g) => {
          setEntering(false);
          setSaid({ text: t("pairing.joined"), ok: true });
          onGroup(g);
        }}
      />
    );
  } else if (stage === "unpaired") {
    body = (
      <>
        <Way
          glyph="IconAdd"
          title={t("pairing.create")}
          sub={t("pairing.createSub")}
          disabled={busy}
          onPress={() => void create()}
        />
        <Way glyph="IconPencil" title={t("pairing.enter")} sub={t("pairing.enterSub")} onPress={() => setEntering(true)} />
      </>
    );
  } else if (shown) {
    body = (
      <>
        <WordSlots words={shown.phrase.split(/\s+/)} code={shown.code} />
        <View style={styles.line}>
          <View style={styles.grow}>
            <Caption>{t("pairing.qrCaption")}</Caption>
          </View>
          <InfoBubble tip={t("pairing.wordsTip")} />
        </View>
        <NextStep />
        <View style={styles.actions}>
          <Button label={t("common.close")} labelKey="common.close" glyph="IconClose" onPress={() => setShown(null)} />
          <Button
            label={copied ? t("common.copied") : t("common.copy")}
            labelKey={copied ? "common.copied" : "common.copy"}
            glyph={copied ? "IconCheck" : "IconCopy"}
            onPress={() => copy(shown.phrase)}
          />
        </View>
      </>
    );
  } else {
    const lead =
      stage === "alone"
        ? t("pairing.aloneLead")
        : stage === "searching" || stage === "new"
          ? t("pairing.searchingLead")
          : t("pairing.pairedLead");
    body = (
      <>
        <Body>{lead}</Body>
        <View style={styles.actions}>
          <Button label={t("pairing.show")} labelKey="pairing.show" glyph="IconEye" disabled={busy} onPress={() => void reveal()} />
          <Button label={t("pairing.leave")} labelKey="pairing.leave" glyph="IconSignOut" disabled={busy} onPress={leave} />
        </View>
      </>
    );
  }

  return (
    <Section title={t("pairing.phraseTitle")} hint={t("pairing.phraseHint")} hue={1}>
      {said && said.ok ? <Said>{said.text}</Said> : null}
      {body}
      {said && !said.ok ? <Refusal text={said.text} /> : null}
    </Section>
  );
}

/** A result that went through, on a faint wash of the ok colour. */
function Said({ children }: { children: ReactNode }) {
  const { p, corners } = useTheme();
  return (
    <View style={[styles.note, { backgroundColor: softOn(p.okInk), ...corners.control }]}>
      <Text style={[styles.noteText, { color: p.text }]}>{children}</Text>
    </View>
  );
}

/** One of two ways forward, as a tile large enough to say what happens after it. */
function Way({
  glyph,
  title,
  sub,
  disabled = false,
  onPress,
}: {
  glyph: string;
  title: string;
  sub: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { p, corners, accent } = useTheme();
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      android_ripple={{ color: p.hover }}
      style={[styles.way, { backgroundColor: p.surface2, ...corners.control }, disabled ? styles.dimmed : null]}
    >
      <View style={[styles.wayMark, { backgroundColor: accent, ...corners.control }]}>
        <Glyph name={glyph} color={contrastOn(accent)} size={20} />
      </View>
      <View style={styles.grow}>
        <Text style={[styles.strong, { color: p.text }]}>{title}</Text>
        <Body>{sub}</Body>
      </View>
    </Press>
  );
}

/** The way to the button to press on the other instance. */
function NextStep() {
  const { t } = useT();
  const { p, corners } = useTheme();
  const path = [t("nav.settings"), t("settings.pairing"), t("pairing.enter")];
  return (
    <View style={[styles.well, { backgroundColor: p.surface2, ...corners.control }]}>
      <Text style={[styles.strong, { color: p.text }]}>{t("pairing.nextTitle")}</Text>
      <Body>
        {path.map((step, i) => (
          <Text key={i}>
            {i > 0 ? " › " : ""}
            <Text style={i === path.length - 1 ? [styles.strong, { color: p.text }] : null}>{step}</Text>
          </Text>
        ))}{" "}
        {t("pairing.nextTail")}
      </Body>
    </View>
  );
}

/**
 * The twelve words in numbered tiles, the same wherever they appear: shown to
 * be read out, or filling as somebody types them. With a code, the QR code
 * stands under them.
 */
function WordSlots({ words, unknown = [], code }: { words: string[]; unknown?: number[]; code?: string }) {
  const { p, corners } = useTheme();
  const bad = new Set(unknown);
  return (
    <>
      <View style={styles.slots}>
        {Array.from({ length: PHRASE_WORDS }, (_, i) => {
          const w = words[i];
          const ink = w === undefined ? p.textMuted : bad.has(i) ? p.failInk : p.text;
          // An empty slot is sunk to the page's shade rather than outlined.
          const ground = w === undefined ? p.background : bad.has(i) ? softOn(p.failInk, 0.18) : p.surface2;
          return (
            <View key={i} style={[styles.slot, { backgroundColor: ground, ...corners.control }]}>
              <Text style={[styles.slotNumber, { color: p.textMuted }]}>{i + 1}</Text>
              <Text style={[styles.slotWord, { color: ink }]} numberOfLines={1}>
                {w ?? "·"}
              </Text>
            </View>
          );
        })}
      </View>
      {code ? (
        <View style={styles.qr}>
          <QR value={code} size={168} />
        </View>
      ) : null}
    </>
  );
}

/**
 * Takes the twelve words of another instance. It reads a paste with line
 * breaks, list numbers and commas, fills the slots as the words arrive and
 * names an unknown word with its place before anything is sent. Pair waits for
 * twelve known words, and whether they belong together only the engine can say.
 */
function PhraseEntry({ onBack, onPaired }: { onBack: () => void; onPaired: (g: ConnectInfo) => void }) {
  const { t } = useT();
  const { p } = useTheme();
  const [typed, setTyped] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { words, unknown, complete } = checkPhrase(typed);
  const first = unknown[0];

  let problem = refusal;
  if (!problem && first !== undefined) problem = t("pairing.errUnknownWord", { position: first + 1, word: words[first] ?? "" });
  if (!problem && words.length > PHRASE_WORDS) problem = t("pairing.errWordCount", { count: words.length });

  async function pair() {
    setBusy(true);
    try {
      onPaired(await nameOnce(await api.joinGroup(words.join(" "))));
    } catch (e) {
      setRefusal(refusalText(t, e));
    } finally {
      setBusy(false);
    }
  }

  const tip = t("pairing.enterTip", { path: [t("nav.settings"), t("settings.pairing"), t("pairing.show")].join(", ") });
  return (
    <>
      <Field
        label={t("pairing.enterLabel")}
        hint={tip}
        value={typed}
        multiline
        placeholder={t("pairing.enterPlaceholder")}
        onChange={(next) => {
          setTyped(next);
          setRefusal(null);
        }}
      />
      <Text style={[styles.count, { color: complete ? p.okInk : p.textMuted }]} accessibilityLiveRegion="polite">
        {t("pairing.wordCount", { n: words.length })}
      </Text>
      <WordSlots words={words} unknown={unknown} />
      {problem ? <Refusal text={problem} /> : null}
      <View style={styles.actions}>
        <Button label={t("preview.back")} labelKey="preview.back" onPress={onBack} />
        <Button
          label={t("pairing.join")}
          labelKey="pairing.join"
          glyph="IconLink"
          tone="accent"
          busy={busy}
          disabled={!complete}
          onPress={() => void pair()}
        />
      </View>
    </>
  );
}

/**
 * Who is in the group: the instances that wait for approval, this phone with
 * its name and key, the others that are there and the approved ones that are
 * away, each with the button that takes it out.
 */
function GroupCard({
  group,
  onGroup,
  onRefresh,
}: {
  group: ConnectInfo;
  onGroup: (g: ConnectInfo) => void;
  onRefresh: () => void;
}) {
  const { t, lang } = useT();
  const { p, corners } = useTheme();
  const [name, setName] = useState(group.name);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // A field nobody has touched follows the name the engine reports, which
  // changes once the phone has named itself after joining.
  const known = useRef(group.name);
  useEffect(() => {
    setName((typed) => (typed === known.current ? group.name : typed));
    known.current = group.name;
  }, [group.name]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setRefusal(null);
    try {
      await action();
      onRefresh();
    } catch (e) {
      setRefusal(refusalText(t, e));
    } finally {
      setBusy(false);
    }
  }

  const ask = (kind: "refuse" | "remove", id: string, who: string) => {
    const refuse = kind === "refuse";
    Alert.alert(
      refuse ? t("pairing.refuseTitle", { name: who }) : t("pairing.removeTitle", { name: who }),
      refuse ? t("pairing.refuseConfirm", { name: who }) : t("pairing.removeConfirm", { name: who }),
      [
        { text: t("confirm.cancel"), style: "cancel" },
        {
          text: refuse ? t("pairing.refuse") : t("pairing.remove"),
          onPress: () => void run(() => (refuse ? api.refuseMember(id) : api.removeMember(id))),
        },
      ],
    );
  };

  const shownName = (n: string) => n || t("pairing.thisInstance");
  const nobody = group.members.length === 0 && group.away.length === 0 && group.pending.length === 0;
  const kind = kindName(t, group.deployment);

  return (
    <Section title={t("pairing.groupTitle")} hint={t("pairing.groupHint")} hue={2}>
      {group.awaiting ? (
        <View
          accessibilityRole="alert"
          style={[styles.note, { backgroundColor: softOn(p.warnInk), ...corners.control }]}
        >
          <Text style={[styles.noteText, { color: p.text }]}>{t("pairing.awaiting")}</Text>
        </View>
      ) : null}

      {group.pending.length > 0 ? (
        <>
          <AxisLabel hint={t("pairing.pendingTip")}>{t("pairing.pendingTitle")}</AxisLabel>
          {group.pending.map((m) => (
            <Member key={m.id} name={shownName(m.name)} facts={[t("pairing.fingerprint", { fingerprint: m.fingerprint })]}>
              <Button
                label={t("pairing.refuse")}
                labelKey="pairing.refuse"
                glyph="IconClose"
                disabled={busy}
                onPress={() => ask("refuse", m.id, shownName(m.name))}
              />
              <Button
                label={t("pairing.approve")}
                labelKey="pairing.approve"
                glyph="IconConfirm"
                tone="accent"
                disabled={busy}
                onPress={() => void run(() => api.approveMember(m.id))}
              />
            </Member>
          ))}
        </>
      ) : null}

      <View style={[styles.well, { backgroundColor: p.surface2, ...corners.control }]}>
        <View style={styles.line}>
          <Text style={[styles.strong, { color: p.text }]}>{t("pairing.thisInstance")}</Text>
          {kind ? <Caption>{kind}</Caption> : null}
        </View>
        {group.fingerprint ? (
          <View style={styles.line}>
            <View style={styles.grow}>
              <Caption>{t("pairing.ownKey", { fingerprint: group.fingerprint })}</Caption>
            </View>
            <InfoBubble tip={t("pairing.ownKeyTip")} />
          </View>
        ) : null}
        <Field label={t("pairing.nameLabel")} hint={t("pairing.nameHint")} value={name} onChange={setName} />
        <View style={styles.actions}>
          <Button
            label={t("pairing.nameSave")}
            labelKey="pairing.nameSave"
            glyph="IconSave"
            disabled={busy || name === group.name}
            onPress={() => void run(async () => onGroup(await api.renameInstance(name)))}
          />
        </View>
      </View>

      {group.members.map((m) => (
        <Member
          key={m.id}
          name={m.name}
          live
          facts={[kindName(t, m.deployment), t("pairing.online"), m.approved ? t("pairing.approved") : ""]}
        >
          <Button
            label={t("pairing.remove")}
            labelKey="pairing.remove"
            glyph="IconKeyRevoke"
            disabled={busy}
            onPress={() => ask("remove", m.id, m.name)}
          />
        </Member>
      ))}
      {group.away.map((m) => (
        <Member
          key={m.id}
          name={m.name}
          facts={[kindName(t, m.deployment), t("pairing.lastSeen", { time: seenAt(lang, m.lastSeen) })]}
        >
          <Button
            label={t("pairing.remove")}
            labelKey="pairing.remove"
            glyph="IconKeyRevoke"
            disabled={busy}
            onPress={() => ask("remove", m.id, m.name)}
          />
        </Member>
      ))}
      {nobody ? <Body muted>{t("pairing.nobodyYet")}</Body> : null}
      {refusal ? <Refusal text={refusal} /> : null}
    </Section>
  );
}

/** One instance of the group: its name, what it is and how it stands, and what can be done about it. */
function Member({
  name,
  facts,
  live = false,
  children,
}: {
  name: string;
  facts: string[];
  live?: boolean;
  children: ReactNode;
}) {
  const { p, corners } = useTheme();
  return (
    <View style={[styles.well, { backgroundColor: p.surface2, ...corners.control }]}>
      <View style={styles.line}>
        <View style={[styles.dot, { backgroundColor: live ? p.okSolid : p.textMuted }]} />
        <Text style={[styles.strong, styles.grow, { color: p.text }]}>{name}</Text>
      </View>
      <Caption>{facts.filter(Boolean).join(" · ")}</Caption>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

/**
 * Which relay carries the group: the project's, one of the owner's own, or
 * none, with what each one sees.
 */
function RelayCard({
  group,
  relay,
  onRelay,
}: {
  group: ConnectInfo;
  relay: RelayConfig;
  onRelay: (r: RelayConfig) => void;
}) {
  const { t } = useT();
  const { p } = useTheme();
  const [address, setAddress] = useState(relay.relayUrl);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function save(change: { mode?: RelayMode; relayUrl?: string }) {
    setBusy(true);
    setRefusal(null);
    try {
      onRelay(await api.saveRelay(change));
    } catch (e) {
      setRefusal(refusalText(t, e));
    } finally {
      setBusy(false);
    }
  }

  // React Native's URL has no `host`, so the scheme and the path are cut off by hand.
  const host = relay.projectRelayUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0] ?? "";
  const sentence =
    relay.mode === "project"
      ? t("relay.projectSentence", { host })
      : relay.mode === "own"
        ? t("relay.ownSentence")
        : t("relay.offSentence");

  return (
    <Section title={t("relay.title")} hint={t("relay.hint")} hue={5}>
      <Choice<RelayMode>
        hue={0}
        options={[
          { value: "project", label: t("relay.project") },
          { value: "own", label: t("relay.own") },
          { value: "off", label: t("relay.off") },
        ]}
        value={relay.mode}
        disabled={busy}
        onChange={(mode) => {
          if (mode !== relay.mode) void save({ mode });
        }}
      />
      <Body>{sentence}</Body>
      {relay.mode === "own" ? (
        <>
          <Field
            label={t("relay.address")}
            value={address}
            onChange={setAddress}
            placeholder="wss://relay.example.org"
          />
          <View style={styles.actions}>
            <Button
              label={t("relay.save")}
              labelKey="relay.save"
              glyph="IconSave"
              disabled={busy || address === relay.relayUrl}
              onPress={() => void save({ relayUrl: address })}
            />
          </View>
        </>
      ) : null}
      {relay.mode !== "off" ? (
        group.active ? (
          <View style={styles.line}>
            <View style={[styles.dot, { backgroundColor: relay.connected ? p.okSolid : p.failSolid }]} />
            <Body>{relay.connected ? t("relay.connected") : t("relay.notConnected")}</Body>
          </View>
        ) : (
          <Body muted>{t("relay.noGroup")}</Body>
        )
      ) : null}
      {relay.mode !== "off" ? (
        <>
          <View>
            <Text style={[styles.strong, { color: p.text }]}>{t("relay.seesLabel")}</Text>
            <Body>{t("relay.sees")}</Body>
          </View>
          <View>
            <Text style={[styles.strong, { color: p.text }]}>{t("relay.notSeesLabel")}</Text>
            <Body>{t("relay.notSees")}</Body>
          </View>
        </>
      ) : null}
      {refusal ? <Refusal text={refusal} /> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  // A sub-card: a flat inset group one step above the card, as on the overview.
  well: { padding: space.md, gap: space.sm },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  grow: { flex: 1, minWidth: 0 },
  // Wraps, or two long labels clip on a narrow phone.
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  strong: { fontSize: text.body, fontWeight: "600" },
  number: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  numberText: { fontSize: text.meta, fontWeight: "600" },
  way: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, minHeight: TOUCH },
  wayMark: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dimmed: { opacity: 0.45 },
  note: { paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
  noteText: { fontSize: text.subline, lineHeight: 18 },
  // Two words to a row: the longest on the list still fits beside its number.
  slots: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  slot: {
    flexBasis: "45%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: 32,
  },
  slotNumber: { width: 20, textAlign: "right", fontSize: text.meta, fontVariant: ["tabular-nums"] },
  slotWord: { flex: 1, fontFamily: "monospace", fontSize: text.subline },
  qr: { alignItems: "center", paddingTop: space.sm },
  count: { fontSize: text.meta, alignSelf: "flex-end" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
