import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import Constants from "expo-constants";
import { api, EngineError, type ConnectInfo, type RelayConfig, type RelayMode } from "../api";
import { QR } from "../donate";
import { engine } from "../engine";
import { Field, Refusal } from "../fields";
import { fill } from "../glimstone/fortressText";
import { fortressText } from "../glimstone/fortressTexts";
import { Glyph } from "../glyphs";
import { useT, type TranslationKey } from "../i18n";
import { useEngineStream } from "../useEngine";
import { OtherInstances } from "../otherInstances";
import { FORMS, kindName, modeOf, pairStage, refusalText, relayForm, seenAt, type PairStage, type RelayForm } from "../pairing";
import { checkPhrase, PHRASE_WORDS } from "../phraseWords";
import {
  fortressApps,
  fortressHues,
  fortressPermissions,
  pairedWith,
  permissionOf,
  SELF,
  type FortressInfo,
} from "../../../web/src/lib/fortress";
import { useAppearance } from "../settings";
import { contrastOn, softOn, space, text, TOUCH } from "../theme";
import { AxisLabel, Badge, Body, Button, Caption, Choice, InfoBubble, Page, Press, Section, Toggle, useTheme, type Tone } from "../ui";

// What the engine lets an announce carry.
const MAX_NAME = 64;

/** How long typing has to pause before a name or an address is saved. */
const SETTLE_MS = 800;

/**
 * Pairing, as on the web's tile and in BombVault and KnightLoader: three
 * numbered steps, the twelve words, who came with them, this phone, the relay
 * that carries the rest, and the fortress. While Instances is not under More,
 * its cards follow. The phone's own engine does the pairing, and this screen
 * only asks it. In a fortress its phrase is the pairing's, so the fortress
 * card shows and changes it and the group's phrase card steps aside.
 */
export function Pairing() {
  const { t } = useT();
  const [group, setGroup] = useState<ConnectInfo | null>(null);
  const [relay, setRelay] = useState<RelayConfig | null>(null);
  const [fortress, setFortress] = useState<FortressInfo | null>(null);
  const [error, setError] = useState(false);
  const [createdHere, setCreatedHere] = useState(false);
  const inMore = useAppearance().instancesInMore;
  // Counts the reads and the answers the cards hand up, so a read that was out
  // while a newer answer came back cannot put back the state from before.
  const asked = useRef(0);

  const load = useCallback(() => {
    const read = ++asked.current;
    // The fortress has a card of its own, so a fortress that cannot be read
    // leaves the pairing cards standing.
    Promise.all([api.connect(), api.relay(), api.fortress().catch(() => null)]).then(
      ([g, r, f]) => {
        if (read !== asked.current) return;
        setGroup(g);
        setRelay(r);
        setFortress(f);
        setError(false);
      },
      () => read === asked.current && setError(true),
    );
  }, []);

  const takeGroup = useCallback((g: ConnectInfo) => {
    asked.current++;
    setGroup(g);
  }, []);

  // The engine says on its event stream when somebody comes, goes, waits or
  // is approved, or when the relay comes or goes. A stream that opens again
  // missed what happened while it was down, so the screen reads the group then.
  // The other apps of the fortress tell it nothing, so the screen reads it
  // again whenever it comes to the front.
  useFocusEffect(useCallback(() => load(), [load]));
  useEngineStream(
    true,
    (event) => {
      if (event.phase === "group") load();
    },
    load,
  );

  const stage = group ? pairStage(group, createdHere) : "unpaired";
  const inFortress = fortress?.joined === true;

  return (
    <Page>
      <Steps />
      {error ? (
        <Section title={t("settings.pairing")} hue={3}>
          <Refusal text={t("pairing.loadError")} />
        </Section>
      ) : null}
      {group ? (
        <>
          {inFortress ? null : (
            <PhraseCard group={group} stage={stage} onCreatedHere={setCreatedHere} onGroup={takeGroup} onRefresh={load} />
          )}
          <GroupCard group={group} stage={stage} onRefresh={load} />
          <InstanceCard group={group} inFortress={inFortress} onGroup={takeGroup} onRefresh={load} />
          {relay ? (
            <RelayCard
              group={group}
              relay={relay}
              stage={stage}
              onRelay={(r) => {
                setRelay(r);
                load();
              }}
              onRefresh={load}
            />
          ) : null}
          {fortress ? <FortressCard fortress={fortress} pairedWith={pairedWith(group)} onFortress={setFortress} onRefresh={load} /> : null}
        </>
      ) : null}
      {inMore ? null : <OtherInstances firstHue={7 + (fortress ? fortressHues(fortress) : 0)} />}
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

/** Three numbered cards before any button does anything. */
function Steps() {
  const { t } = useT();
  const { p } = useTheme();
  const steps: { title: string; body: ReactNode }[] = [
    { title: t("pairing.step1Title"), body: t("pairing.step1Body") },
    { title: t("pairing.step2Title"), body: emphasize(t("pairing.step2Body", { button: MARK }), t("pairing.enter"), p.text) },
    { title: t("pairing.step3Title"), body: t("pairing.step3Body") },
  ];
  return (
    <>
      {steps.map((s, i) => (
        <Section key={i} step={i + 1} title={s.title} hue={i}>
          <Body>{s.body}</Body>
        </Section>
      ))}
    </>
  );
}

// Stands where a sentence names a button, so the name can go in bold.
const MARK = "⁣";

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
  stage,
  onCreatedHere,
  onGroup,
  onRefresh,
}: {
  group: ConnectInfo;
  stage: PairStage;
  onCreatedHere: (made: boolean) => void;
  onGroup: (g: ConnectInfo) => void;
  onRefresh: () => void;
}) {
  const { t } = useT();
  const [shown, setShown] = useState<{ phrase: string; code: string } | null>(null);
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
      onCreatedHere(false);
      setSaid(null);
    }
    wasActive.current = group.active;
  }, [group.active, onCreatedHere]);

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
      onCreatedHere(true);
      onGroup(await nameOnce(made.info));
    });

  const reveal = () =>
    run(async () => {
      setShown(await api.revealPhrase());
      setCopied(false);
    });

  const quit = (then: () => void = () => {}) =>
    run(async () => {
      await api.leaveGroup();
      setShown(null);
      onCreatedHere(false);
      then();
      onRefresh();
    });

  const leave = () =>
    Alert.alert(t("pairing.leaveTitle"), t("pairing.leaveStakes"), [
      { text: t("confirm.cancel"), style: "cancel" },
      { text: t("pairing.leave"), onPress: () => void quit() },
    ]);

  const copy = (phrase: string) =>
    void engine.copy(phrase).then(
      () => setCopied(true),
      () => {},
    );

  let body: ReactNode;
  let foot: ReactNode = null;
  if (entering) {
    const tip = t("pairing.enterTip", { path: [t("nav.settings"), t("settings.pairing"), t("pairing.show")].join(", ") });
    body = (
      <PhraseEntry
        label={t("pairing.enterLabel")}
        hint={tip}
        join={{ label: t("pairing.join"), key: "pairing.join" }}
        onBack={() => setEntering(false)}
        onJoin={async (phrase) => {
          try {
            const g = await nameOnce(await api.joinGroup(phrase));
            setEntering(false);
            setSaid({ text: t("pairing.joined"), ok: true });
            onGroup(g);
            return null;
          } catch (e) {
            return refusalText(t, e);
          }
        }}
      />
    );
  } else if (stage === "unpaired") {
    body = (
      <>
        <Way glyph="IconAdd" title={t("pairing.create")} sub={t("pairing.createSub")} disabled={busy} onPress={() => void create()} />
        <Way glyph="IconPencil" title={t("pairing.enter")} sub={t("pairing.enterSub")} onPress={() => setEntering(true)} />
      </>
    );
  } else if (shown) {
    body = (
      <>
        <View style={styles.line}>
          <View style={styles.grow}>
            <AxisLabel>{t("pairing.wordsLabel")}</AxisLabel>
          </View>
          <InfoBubble tip={t("pairing.wordsTip")} />
        </View>
        <WordSlots words={shown.phrase.split(/\s+/)} code={shown.code} />
        <Caption>{t("pairing.qrCaption")}</Caption>
        {stage === "new" ? <NextStep /> : null}
      </>
    );
    foot = (
      <>
        <Button label={t("common.close")} labelKey="common.close" glyph="IconClose" onPress={() => setShown(null)} />
        <Button
          label={copied ? t("common.copied") : t("common.copy")}
          labelKey={copied ? "common.copied" : "common.copy"}
          glyph={copied ? "IconCheck" : "IconCopy"}
          onPress={() => copy(shown.phrase)}
        />
      </>
    );
  } else {
    const lead: TranslationKey = stage === "alone" ? "pairing.aloneLead" : stage === "paired" ? "pairing.pairedLead" : "pairing.searchingLead";
    body =
      stage === "new" ? (
        <>
          <View style={[styles.line, styles.end]}>
            <Caption>{t("pairing.notFirst")}</Caption>
            <Button
              label={t("pairing.enter")}
              labelKey="pairing.enter"
              glyph="IconPencil"
              disabled={busy}
              onPress={() => void quit(() => setEntering(true))}
            />
          </View>
          <NextStep />
        </>
      ) : (
        <Body>{t(lead)}</Body>
      );
    foot = (
      <>
        <Button label={t("pairing.show")} labelKey="pairing.show" glyph="IconEye" disabled={busy} onPress={() => void reveal()} />
        <Button label={t("pairing.leave")} labelKey="pairing.leave" glyph="IconSignOut" disabled={busy} onPress={leave} />
      </>
    );
  }

  return (
    <Section title={t("pairing.phraseTitle")} hint={t("pairing.phraseHint")} hue={3}>
      {said && said.ok ? <Said>{said.text}</Said> : null}
      {body}
      {said && !said.ok ? <Refusal text={said.text} /> : null}
      {foot ? <View style={[styles.actions, styles.end]}>{foot}</View> : null}
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

/** The button to press on the other instance, along the path to it, on the accent's faint wash. */
function NextStep() {
  const { t } = useT();
  const { p, corners, accent } = useTheme();
  const path = [t("nav.settings"), t("settings.pairing"), t("pairing.enter")];
  return (
    <View style={[styles.next, { backgroundColor: softOn(accent), ...corners.control }]}>
      <View style={[styles.nextMark, { backgroundColor: accent }]}>
        <Svg width={14} height={14} viewBox="0 0 20 20" fill="none" stroke={contrastOn(accent)} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M3.8 10h11.9M11.3 5.6 15.7 10l-4.4 4.4" />
        </Svg>
      </View>
      <View style={styles.grow}>
        <Text style={[styles.strong, { color: p.text }]}>{t("pairing.nextTitle")}</Text>
        <Body>
          <Text style={[styles.strong, { color: p.text }]}>{path.join(" › ")}</Text> {t("pairing.nextTail")}
        </Body>
      </View>
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
 * names an unknown word with its place before anything is sent. The button
 * waits for twelve known words, and whether they belong together only the
 * engine can say. `onJoin` answers with the reason it was refused, if it was.
 */
function PhraseEntry({
  label,
  hint,
  join,
  onBack,
  onJoin,
}: {
  /** What the words are, which differs between the group and the fortress. */
  label: string;
  hint: string;
  join: { label: string; key: string };
  onBack: () => void;
  onJoin: (phrase: string) => Promise<string | null>;
}) {
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
    setRefusal(await onJoin(words.join(" ")));
    setBusy(false);
  }

  return (
    <>
      <Field
        label={label}
        hint={hint}
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
      <View style={[styles.actions, styles.end]}>
        <Button label={t("preview.back")} labelKey="preview.back" onPress={onBack} />
        <Button
          label={join.label}
          labelKey={join.key}
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

const DEVICE_GLYPH: Record<string, string> = { phone: "IconPhone", pc: "IconApp", laptop: "IconApp" };

/**
 * The fortress, as on the web's Pairing tile: outside one, the twelve words
 * join it; inside, the other apps with the permissions that involve ArrowLoop,
 * the phrase with its QR code, a new phrase and the way out. The words show
 * behind the password where the engine has one, else behind the phone's own
 * lock. Every switch saves as it flips.
 */
function FortressCard({
  fortress,
  pairedWith: paired,
  onFortress,
  onRefresh,
}: {
  fortress: FortressInfo;
  /** The instances whose pairing comes along on joining and ends on leaving. */
  pairedWith: string[];
  onFortress: (f: FortressInfo) => void;
  /** Reads the group again, which joining and leaving change as well. */
  onRefresh: () => void;
}) {
  const { t, lang } = useT();
  const { p } = useTheme();
  const text = fortressText(lang);
  const [entering, setEntering] = useState(false);
  // Which of the two the password field stands in front of.
  const [asking, setAsking] = useState<"show" | "change" | null>(null);
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState<{ phrase: string; code: string; left?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [said, setSaid] = useState<{ text: string; ok: boolean; more?: string } | null>(null);

  // Words shown here belong to the fortress they were shown for. The desktop
  // or the web can leave it, and reading it again is the only sign.
  useEffect(() => {
    if (fortress.joined) return;
    setShown(null);
    setAsking(null);
  }, [fortress.joined]);

  const app = { app: SELF.name };
  const devices = paired.join(", ");
  const refused = (e: unknown) => (e instanceof EngineError && e.status === 403 ? text.passwordWrong : refusalText(t, e));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setSaid(null);
    try {
      await action();
    } catch (e) {
      setSaid({ text: refused(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  const reveal = (words: { phrase: string; code: string; left?: string[] }) => {
    setShown(words);
    setAsking(null);
    setPassword("");
    setCopied(false);
  };
  const show = (typed = "") => run(async () => reveal(await api.showFortressPhrase(typed)));
  const change = (typed = "") =>
    run(async () => {
      reveal(await api.changeFortressPhrase(typed));
      onRefresh();
    });

  async function unlocked(): Promise<boolean> {
    if (!(await engine.hasDeviceLock().catch(() => false))) return true;
    return engine.confirmDeviceLock(text.phraseTitle, text.phraseBody).catch(() => false);
  }

  function start(what: "show" | "change") {
    setSaid(null);
    if (fortress.passwordSet) {
      setAsking(what);
      setPassword("");
      return;
    }
    void unlocked().then((ok) => {
      if (ok) void (what === "show" ? show() : change());
    });
  }

  const askChange = () =>
    Alert.alert(text.changeTitle, `${text.changeBody}\n\n${text.changeAway}`, [
      { text: text.cancel, style: "cancel" },
      { text: text.changeConfirm, onPress: () => start("change") },
    ]);

  const leave = () =>
    Alert.alert(
      text.leaveTitle,
      [fill(text.leaveBody, app), paired.length > 0 ? fill(text.leavePairing, { devices }) : "", text.leaveBack].filter(Boolean).join("\n\n"),
      [
        { text: text.cancel, style: "cancel" },
        {
          text: text.leaveConfirm,
          style: "destructive",
          onPress: () =>
            void run(async () => {
              onFortress(await api.leaveFortress());
              onRefresh();
            }),
        },
      ],
    );

  async function join(phrase: string): Promise<string | null> {
    try {
      onFortress(await api.joinFortress(phrase));
      setEntering(false);
      setSaid({ text: fill(text.joinedTitle, app), ok: true, more: paired.length > 0 ? fill(text.joinedMoved, { devices }) : undefined });
      onRefresh();
      return null;
    } catch (e) {
      return e instanceof EngineError && e.code === "inFortress" ? t("fortress.inFortress") : refusalText(t, e);
    }
  }

  const flip = (id: string, on: boolean) => {
    setSaid(null);
    api.setFortressPermission(permissionOf(id, on)).then(onFortress, (e: unknown) => setSaid({ text: refusalText(t, e), ok: false }));
  };

  const copy = (phrase: string) =>
    void engine.copy(phrase).then(
      () => setCopied(true),
      () => {},
    );

  let body: ReactNode;
  let foot: ReactNode = null;
  if (!fortress.joined) {
    body = entering ? (
      <>
        {paired.length > 0 ? <Body>{fill(text.moves, { ...app, devices })}</Body> : null}
        <PhraseEntry label={text.phraseTitle} hint={t("fortress.phraseWhere")} join={{ label: text.join, key: "pairing.join" }} onBack={() => setEntering(false)} onJoin={join} />
      </>
    ) : (
      <>
        <Text style={[styles.strong, { color: p.text }]}>{text.outTitle}</Text>
        <Body>{t("fortress.outBody", { app: SELF.name })}</Body>
      </>
    );
    if (!entering) {
      foot = <Button label={text.joinTitle} labelKey="pairing.join" tone="accent" onPress={() => setEntering(true)} />;
    }
  } else if (asking) {
    body = (
      <>
        <Body>{fill(text.phrasePassword, app)}</Body>
        <Field label={fill(text.password, app)} value={password} secret onChange={setPassword} />
      </>
    );
    foot = (
      <>
        <Button
          label={text.cancel}
          labelKey="confirm.cancel"
          onPress={() => {
            setAsking(null);
            if (asking === "change") setSaid({ text: t("fortress.changeKept"), ok: true });
          }}
        />
        <Button
          label={asking === "show" ? text.unlock : text.changeConfirm}
          labelKey={asking === "show" ? "pairing.show" : "fortress.changePhrase"}
          tone="accent"
          busy={busy}
          disabled={password === ""}
          onPress={() => void (asking === "show" ? show(password) : change(password))}
        />
      </>
    );
  } else if (shown) {
    body = (
      <>
        <AxisLabel>{shown.left ? text.changedTitle : text.phraseTitle}</AxisLabel>
        <WordSlots words={shown.phrase.split(/\s+/)} code={shown.code} />
        <Caption>{text.scanHint}</Caption>
        {shown.left && shown.left.length > 0 ? <Body>{fill(text.changedLeft, { devices: shown.left.join(", ") })}</Body> : null}
      </>
    );
    foot = (
      <>
        <Button label={text.close} labelKey="common.close" glyph="IconClose" onPress={() => setShown(null)} />
        <Button
          label={copied ? text.copied : text.copy}
          labelKey={copied ? "common.copied" : "common.copy"}
          glyph={copied ? "IconCheck" : "IconCopy"}
          onPress={() => copy(shown.phrase)}
        />
      </>
    );
  } else {
    const apps = fortressApps(fortress.members, (unix) => seenAt(lang, unix));
    const permissions = fortressPermissions(fortress.permissions, fortress.members, t);
    body = (
      <>
        {apps.map((a) => (
          <View key={a.id} style={styles.app}>
            <AxisLabel>{a.name}</AxisLabel>
            {a.instances.map((i) => (
              <Member
                key={i.id}
                glyph={DEVICE_GLYPH[i.deviceKind] ?? "IconServer"}
                name={i.device}
                mark={i.form ? (text.forms[i.form as keyof typeof text.forms] ?? i.form) : undefined}
                note={i.lastSeen ? fill(text.lastSeen, { time: i.lastSeen }) : undefined}
              >
                <Badge label={i.presence === "connected" ? text.connected : text.away} tone={i.presence === "connected" ? "ok" : "neutral"} />
                {i.relay ? <Badge label={text.viaRelay} /> : null}
              </Member>
            ))}
          </View>
        ))}
        <AxisLabel hint={text.permissionsAbout}>{text.permissions}</AxisLabel>
        {permissions.length === 0 ? <Caption>{text.noPermissions}</Caption> : null}
        {permissions.map((perm) => (
          <Toggle key={perm.id} label={perm.title} hint={perm.detail} value={perm.on} onChange={(on) => flip(perm.id, on)} />
        ))}
      </>
    );
    foot = (
      <>
        {fortress.phrase ? (
          <>
            <Button label={text.showPhrase} labelKey="pairing.show" glyph="IconEye" disabled={busy} onPress={() => start("show")} />
            <Button label={text.changePhrase} labelKey="fortress.changePhrase" glyph="IconRefresh" disabled={busy} onPress={askChange} />
          </>
        ) : null}
        <Button label={text.leave} labelKey="pairing.leave" glyph="IconSignOut" disabled={busy} onPress={leave} />
      </>
    );
  }

  return (
    <Section title={t("fortress.title")} hint={text.about} hue={7}>
      {said && said.ok ? (
        <Said>
          {said.text}
          {said.more ? `\n${said.more}` : null}
        </Said>
      ) : null}
      {body}
      {said && !said.ok ? <Refusal text={said.text} /> : null}
      {foot ? <View style={[styles.actions, styles.end]}>{foot}</View> : null}
    </Section>
  );
}

/** The badge each stage shows on this phone's row once there is a group. */
const STAGE_BADGE: Record<Exclude<PairStage, "unpaired" | "paired">, { tone: Tone; key: TranslationKey }> = {
  new: { tone: "accent", key: "pairing.stateNew" },
  searching: { tone: "neutral", key: "pairing.stateSearching" },
  gone: { tone: "neutral", key: "pairing.stateSearching" },
  alone: { tone: "warn", key: "pairing.stateAlone" },
};

const GLYPH: Record<string, string> = { phone: "IconPhone", desktop: "IconApp" };

/**
 * Who is in the group: the instances that wait for approval, this phone with
 * where it stands, the others that are there and the approved ones that are
 * away, each with the button that takes it out.
 */
function GroupCard({ group, stage, onRefresh }: { group: ConnectInfo; stage: PairStage; onRefresh: () => void }) {
  const { t, lang } = useT();
  const { p, corners } = useTheme();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

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
  const remove = (id: string, who: string) => (
    <Button label={t("pairing.remove")} labelKey="pairing.remove" glyph="IconKeyRevoke" disabled={busy} onPress={() => ask("remove", id, who)} />
  );
  const badge = stage !== "unpaired" && stage !== "paired" ? STAGE_BADGE[stage] : null;

  return (
    <Section title={t("nav.instances")} hint={t("pairing.groupHint")} hue={4}>
      {group.awaiting ? (
        <View accessibilityRole="alert" style={[styles.note, { backgroundColor: softOn(p.warnInk), ...corners.control }]}>
          <Text style={[styles.noteText, { color: p.text }]}>{t("pairing.awaiting")}</Text>
        </View>
      ) : null}

      {group.pending.length > 0 ? (
        <View style={[styles.well, { backgroundColor: p.surface2, ...corners.control }]}>
          <AxisLabel hint={t("pairing.pendingTip")}>{t("pairing.pendingTitle")}</AxisLabel>
          {group.pending.map((m) => (
            <Member key={m.id} glyph="IconServer" name={shownName(m.name)} note={t("pairing.fingerprint", { fingerprint: m.fingerprint })}>
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
        </View>
      ) : null}

      <Member glyph={GLYPH[group.deployment] ?? "IconServer"} name={shownName(group.name)} mark={t("pairing.thisInstance")}>
        {stage === "paired" ? <Approved label={t("pairing.paired")} /> : null}
        {badge ? <Badge label={t(badge.key)} tone={badge.tone} /> : null}
      </Member>
      {group.members.map((m) => (
        <Member key={m.id} glyph={GLYPH[m.deployment] ?? "IconServer"} name={m.name || m.id} mark={kindName(t, m.deployment)}>
          {m.approved ? <Approved label={t("pairing.approved")} /> : <Badge label={t("pairing.pendingTitle")} tone="warn" />}
          {remove(m.id, m.name)}
        </Member>
      ))}
      {group.away.map((m) => (
        <Member
          key={m.id}
          glyph={GLYPH[m.deployment] ?? "IconServer"}
          name={m.name || m.id}
          mark={kindName(t, m.deployment)}
          note={m.lastSeen > 0 ? t("pairing.lastSeen", { time: seenAt(lang, m.lastSeen) }) : undefined}
        >
          <Badge label={t("pairing.inactive")} />
          {remove(m.id, m.name)}
        </Member>
      ))}
      {stage === "new" ? <WaitRow text={t("pairing.waitNext")} /> : null}
      {stage === "searching" || stage === "alone" || stage === "gone" ? <WaitRow text={t("pairing.searching")} /> : null}
      {refusal ? <Refusal text={refusal} /> : null}
    </Section>
  );
}

/** Approved is a state and nothing to press, so it is a dot and a word. */
function Approved({ label }: { label: string }) {
  const { p } = useTheme();
  return (
    <View style={styles.line}>
      <View style={[styles.dot, { backgroundColor: p.okSolid }]} />
      <Caption>{label}</Caption>
    </View>
  );
}

/** One instance of the group: a glyph, its name and kind, how it stands, and what can be done about it. */
function Member({
  glyph,
  name,
  mark,
  note,
  children,
}: {
  glyph: string;
  name: string;
  mark?: string;
  note?: string;
  children?: ReactNode;
}) {
  const { p, accentInk } = useTheme();
  return (
    <View style={[styles.member, { borderTopColor: p.border }]}>
      <View style={styles.line}>
        <Glyph name={glyph} color={accentInk} size={18} />
        <Text style={[styles.strong, styles.grow, { color: p.text }]}>{name}</Text>
        {mark ? <Text style={[styles.mark, { color: p.textSub }]}>{mark}</Text> : null}
      </View>
      {note ? <Caption>{note}</Caption> : null}
      {children ? <View style={[styles.actions, styles.end]}>{children}</View> : null}
    </View>
  );
}

/** A line under the group that says it is still waiting. */
function WaitRow({ text: said }: { text: string }) {
  const { p, accentInk } = useTheme();
  return (
    <View style={[styles.line, styles.member, { borderTopColor: p.border }]}>
      <View style={styles.line}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.waitDot, { backgroundColor: accentInk }]} />
        ))}
      </View>
      <Caption>{said}</Caption>
    </View>
  );
}

/**
 * This phone as the others see it: the name it goes by, saved on its own once
 * typing pauses, and the key to compare when it waits for approval. In a
 * fortress the name goes to the fortress, which tells the other apps as well.
 */
function InstanceCard({
  group,
  inFortress,
  onGroup,
  onRefresh,
}: {
  group: ConnectInfo;
  inFortress: boolean;
  onGroup: (g: ConnectInfo) => void;
  onRefresh: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(group.name);
  const [refusal, setRefusal] = useState<string | null>(null);
  const typing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The screen reads the group again whenever it changes, which must not undo what is being typed.
  useEffect(() => {
    if (!typing.current) setName(group.name);
  }, [group.name]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function type(next: string) {
    typing.current = true;
    setName(next);
    setRefusal(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const saved = inFortress ? api.nameInFortress(next).then(onRefresh) : api.renameInstance(next).then(onGroup);
      saved
        .catch((e: unknown) => setRefusal(refusalText(t, e)))
        .finally(() => {
          typing.current = false;
        });
    }, SETTLE_MS);
  }

  return (
    <Section title={t("pairing.thisInstance")} hue={5}>
      <Field label={t("pairing.nameLabel")} hint={t("pairing.nameHint")} value={name} onChange={type} />
      {refusal ? <Refusal text={refusal} /> : null}
      {group.fingerprint ? (
        <View style={styles.line}>
          <View style={styles.grow}>
            <Caption>{t("pairing.ownKey", { fingerprint: group.fingerprint })}</Caption>
          </View>
          <InfoBubble tip={t("pairing.ownKeyTip")} />
        </View>
      ) : null}
    </Section>
  );
}

const CLOUD = "M5.4 16.5h9.2a3.9 3.9 0 0 0 .6-7.8A5.4 5.4 0 0 0 4.9 7.3a4.6 4.6 0 0 0 .5 9.2z";

/** A relay route as a filled glyph, as the web's selector draws it; an instance keeps its line glyph. */
function RouteMark({ mode, ink }: { mode: RelayForm; ink: string }) {
  if (mode === "instance") {
    return (
      <Svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke={ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M5.3 9h9.4a1.8 1.8 0 0 1 1.8 1.8v4.4a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8v-4.4A1.8 1.8 0 0 1 5.3 9z" />
        <Path d="M6.5 13h.01M7 5.8a4.4 4.4 0 0 1 6 0M4.8 3.6a7.6 7.6 0 0 1 10.4 0" />
      </Svg>
    );
  }
  if (mode === "own") {
    return (
      <Svg width={18} height={18} viewBox="0 0 20 20" fill={ink}>
        <Path d="M10 2.4 2.3 9.2c-.5.4-.2 1.2.5 1.2h1.6V17a1 1 0 0 0 1 1h3.1v-4.6h3V18h3.1a1 1 0 0 0 1-1v-6.6h1.6c.7 0 1-.8.5-1.2z" />
      </Svg>
    );
  }
  return (
    <Svg width={18} height={18} viewBox="0 0 20 20" fill={ink}>
      <Path d={CLOUD} opacity={mode === "off" ? 0.55 : 1} />
      {mode === "off" ? <Path d="M3.2 3.2l13.6 13.6" stroke={ink} strokeWidth={1.8} strokeLinecap="round" /> : null}
    </Svg>
  );
}

const COPY: Record<RelayForm, { name: TranslationKey; sentence: TranslationKey; need: TranslationKey }> = {
  project: { name: "relay.project", sentence: "relay.projectSentence", need: "relay.projectNeed" },
  own: { name: "relay.own", sentence: "relay.ownSentence", need: "relay.ownNeed" },
  instance: { name: "relay.instanceName", sentence: "relay.instanceSub", need: "relay.instanceNeed" },
  off: { name: "relay.off", sentence: "relay.offSentence", need: "relay.offNeed" },
};

const EXAMPLE: Partial<Record<RelayForm, string>> = {
  own: "wss://relay.example.org",
  instance: "https://arrowloop.example.org/relay/connect",
};

// The relay key of an address without TLS crosses the network in the clear.
const PLAINTEXT_RELAY = /^(ws|http):\/\//i;

/**
 * Which relay carries the group: the project's, one of the owner's own, an
 * ArrowLoop of the group that serves one, or none. A phone is reached by
 * nobody, so it never serves the relay itself; it dials the instance that
 * does. Each route says in one sentence what it is and what it needs. Every
 * control saves on its own.
 */
function RelayCard({
  group,
  relay,
  stage,
  onRelay,
  onRefresh,
}: {
  group: ConnectInfo;
  relay: RelayConfig;
  stage: PairStage;
  onRelay: (r: RelayConfig) => void;
  onRefresh: () => void;
}) {
  const { t } = useT();
  const { p, corners } = useTheme();
  const [mode, setMode] = useState<RelayMode>(relay.mode);
  // Which of the two own routes was picked here; the engine stores one mode for both.
  const [picked, setPicked] = useState<"own" | "instance" | null>(null);
  const [address, setAddress] = useState(relay.relayUrl);
  const [refusal, setRefusal] = useState<string | null>(null);
  const typing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The screen reads the relay again whenever the group changes, which must not undo what is being typed or picked.
  useEffect(() => {
    if (!typing.current) setAddress(relay.relayUrl);
  }, [relay.relayUrl]);
  useEffect(() => setMode(relay.mode), [relay.mode]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const form: RelayForm = mode !== "own" ? mode : (picked ?? relayForm({ ...relay, mode, relayUrl: address }));

  function pick(next: RelayForm) {
    setPicked(next === "own" || next === "instance" ? next : null);
    const stored = modeOf(next);
    if (stored === mode) return;
    const before = mode;
    setMode(stored);
    setRefusal(null);
    api.saveRelay({ mode: stored }).then(onRelay, (e: unknown) => {
      setMode(before);
      setRefusal(refusalText(t, e));
    });
  }

  function type(next: string) {
    typing.current = true;
    setAddress(next);
    setRefusal(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api
        .saveRelay({ relayUrl: next })
        .then(onRelay, (e: unknown) => setRefusal(refusalText(t, e)))
        .finally(() => {
          typing.current = false;
        });
    }, SETTLE_MS);
  }

  // React Native's URL has no `host`, so the scheme and the path are cut off by hand.
  const host = relay.projectRelayUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0] ?? "";
  const copy = COPY[form];
  const state: { label: string; tone: Tone } =
    mode === "off"
      ? { label: t("relay.off"), tone: "neutral" }
      : !group.active
        ? { label: t("relay.noGroup"), tone: "neutral" }
        : relay.connected
          ? { label: t("relay.connected"), tone: "ok" }
          : { label: t("relay.notConnected"), tone: "warn" };

  const sees = () =>
    Alert.alert(t("relay.seesTitle"), `${t("relay.seesLabel")} ${t("relay.sees")}\n\n${t("relay.notSeesLabel")} ${t("relay.notSees")}`);

  return (
    <Section title={t("relay.title")} hint={t("relay.hint")} hue={6}>
      <Choice<RelayForm>
        hue={0}
        options={FORMS.map((m) => ({
          value: m,
          label: t(COPY[m].name),
          mark: (ink: string) => <RouteMark mode={m} ink={ink} />,
        }))}
        value={form}
        onChange={pick}
      />
      <View style={[styles.line, styles.end]}>
        <Badge label={state.label} tone={state.tone} />
      </View>
      <Body>{mode === "project" ? t(copy.sentence, { host }) : t(copy.sentence)}</Body>
      <Body>
        <Text style={[styles.strong, { color: p.text }]}>{t("relay.needLabel")} </Text>
        {t(copy.need)}
      </Body>
      {form === "own" || form === "instance" ? (
        <Field label={t("relay.address")} value={address} onChange={type} placeholder={EXAMPLE[form]} />
      ) : null}
      {PLAINTEXT_RELAY.test(address.trim()) && mode === "own" ? (
        <View accessibilityRole="alert" style={[styles.note, { backgroundColor: softOn(p.warnInk), ...corners.control }]}>
          <Text style={[styles.noteText, { color: p.text }]}>{t("relay.plaintextWarning")}</Text>
        </View>
      ) : null}
      {mode !== "off" ? (
        <View style={styles.line}>
          <View style={styles.grow}>
            <Body>{t("relay.e2e")}</Body>
          </View>
          <InfoBubble tip={t("relay.e2eTip")} />
        </View>
      ) : null}
      {stage !== "unpaired" && mode !== "off" && !relay.connected ? (
        <RelayCheck mode={mode} host={host} onRefresh={onRefresh} />
      ) : null}
      {refusal ? <Refusal text={refusal} /> : null}
      {mode !== "off" ? (
        <View style={[styles.actions, styles.end]}>
          <Button label={t("relay.seesTitle")} labelKey="relay.seesTitle" glyph="IconEye" onPress={sees} />
        </View>
      ) : null}
    </Section>
  );
}

/** What to look at on this phone while the relay cannot be reached. */
function RelayCheck({ mode, host, onRefresh }: { mode: RelayMode; host: string; onRefresh: () => void }) {
  const { t } = useT();
  const { p, corners } = useTheme();
  const items = [mode === "project" ? t("pairing.relayCheckProject", { host }) : t("pairing.relayCheckOwn"), t("pairing.relayCheckFilter")];
  return (
    <View style={[styles.well, { backgroundColor: p.surface2, ...corners.control }]}>
      <AxisLabel>{t("pairing.relayCheckOpen")}</AxisLabel>
      <Body>{t("pairing.relayCheckLead")}</Body>
      {items.map((item) => (
        <Body key={item}>{`• ${item}`}</Body>
      ))}
      <View style={[styles.actions, styles.end]}>
        <Button label={t("pairing.checkAgain")} labelKey="pairing.checkAgain" glyph="IconRetry" onPress={onRefresh} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A sub-card: a flat inset group one step above the card, as on the overview.
  well: { padding: space.md, gap: space.sm },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  grow: { flex: 1, minWidth: 0 },
  end: { justifyContent: "flex-end" },
  // Wraps, or two long labels clip on a narrow phone.
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  strong: { fontSize: text.body, fontWeight: "600" },
  mark: { fontSize: text.meta, textTransform: "uppercase", letterSpacing: 1.4 },
  way: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, minHeight: TOUCH },
  wayMark: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  next: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  nextMark: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  dimmed: { opacity: 0.45 },
  note: { paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
  noteText: { fontSize: text.subline, lineHeight: 18 },
  member: { gap: space.xs, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  app: { gap: space.xs },
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
  dot: { width: 7, height: 7, borderRadius: 4 },
  waitDot: { width: 6, height: 6, borderRadius: 3 },
});
