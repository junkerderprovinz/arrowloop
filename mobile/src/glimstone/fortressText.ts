// The fortress's words and the three helpers that fill them in. GlimStone
// carries them in every language the glossary (@glimstone/terms) holds, in
// fortressLocales/, one module per language, so an app can load just its own.

export { en as fortressTextEn } from "./fortressLocales/en.ts";

/** A sentence with a count, by the plural categories of the language (Intl.PluralRules). `other` is always there. */
export type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

/** Why the fortress did not open a member, as the kit's refusal codes name it. `failed` stands for every other reason. */
export const FORTRESS_OPEN_REFUSALS = ["unreachable", "no_ui", "permission_off", "ui_no_login", "busy", "removed", "closed", "too_large", "failed"] as const;
export type FortressOpenRefusal = (typeof FORTRESS_OPEN_REFUSALS)[number];

/** The states of a member's status report, from best to worst. */
export type FortressMemberState = "off" | "ok" | "starting" | "warning" | "overdue" | "failed";

export interface FortressText {
  /** The switch that shows the other apps of the fortress. */
  showOthers: string;
  /** The (i) beside it: what a fortress is, in two short sentences. */
  about: string;
  /** "{count} more apps", the first half of `othersLine`. */
  othersApps: Plural;
  /** "{count} devices", in the form `othersLine` needs it. */
  othersDevices: Plural;
  /** "{apps} on {devices}", and that the switch holds for this device alone. */
  othersLine: string;
  connected: string;
  checking: string;
  away: string;
  viaRelay: string;
  /** The eyebrow on the card of the instance the person is looking at. */
  thisInstance: string;
  lastSeen: string;
  instanceCount: Plural;
  /** The forms an app comes in, as an eyebrow and in a row. */
  forms: Record<"container" | "plugin" | "desktop" | "android" | "extension", string>;
  open: string;
  /** "Open in {host}", for an app that lives inside another page, such as Unraid's. */
  openIn: string;
  /** Why a member did not open, by refusal code, word for word what the kit's page says. `openRefusalText` picks one. */
  openRefused: Record<FortressOpenRefusal, string>;
  /** The warning badge on a card where two members claim the same app on the same device, and its (i). */
  doubtBadge: string;
  doubtHint: string;
  /** The question before such a member opens, which names it by the end of its id. */
  doubtTitle: string;
  doubtBody: string;
  openAnyway: string;
  remove: string;
  /** An instance of another app by name, "{app} on {device}", in the remove window and the reminder. */
  memberOn: string;
  outTitle: string;
  outHint: string;
  /** The empty place, once another member removed this app, until it joins again. */
  removedHereTitle: string;
  removedHereHint: string;
  /** A member of a fortress seen on the network while this app is in none. */
  found: string;
  enterPhrase: string;
  showPhrase: string;
  changePhrase: string;
  leave: string;
  joinTitle: string;
  /** The name of one word's field, "Word {n}". */
  word: string;
  /** Where the phrase is found, and that a pasted phrase spreads over the fields. */
  phraseWhere: string;
  /** The pairing that moves into the fortress on joining, with `{devices}` as a list. */
  moves: string;
  join: string;
  /** For an app to pass as the error when the words open no fortress. */
  joinRefused: string;
  joinedTitle: string;
  joinedMoved: string;
  joinedNext: string;
  cancel: string;
  close: string;
  leaveTitle: string;
  leaveBody: string;
  leavePairing: string;
  leaveBack: string;
  leaveConfirm: string;
  removeTitle: string;
  removeBody: string;
  removeBack: string;
  /** The step after a removal that offers the new phrase, since the old one still lets the instance back in. */
  removedTitle: string;
  removedBody: string;
  later: string;
  /** The line that stays while instances removed since the last change could get back in, with `{devices}` as a list. */
  removedNote: string;
  phraseTitle: string;
  phrasePassword: string;
  password: string;
  unlock: string;
  /** For an app to pass as the error when the password is wrong. */
  passwordWrong: string;
  showPassword: string;
  hidePassword: string;
  phraseBody: string;
  /** The name of the QR code beside the words. */
  qrName: string;
  /** The line under the QR code: which app scans it. */
  scanHint: string;
  copy: string;
  copied: string;
  /** The heading of the pairing settings, where the phrase changes and the app leaves. */
  pairing: string;
  /** The verb beside the phrase in the pairing settings. */
  change: string;
  changePhraseAbout: string;
  /** The row in the pairing settings that leaves the fortress. */
  leaveRow: string;
  leaveAbout: string;
  changeTitle: string;
  changeBody: string;
  changeAway: string;
  changeConfirm: string;
  changedTitle: string;
  changedLeft: string;
  permissions: string;
  /** The small confirmation once a permission is saved on, and off. */
  permissionOn: string;
  permissionOff: string;
  permissionsAbout: string;
  all: string;
  withApp: string;
  noPermissions: string;
  failed: string;
  /** The status window of a member without pages of its own. Where an Unraid plugin keeps its settings. */
  statusWhere: string;
  statusLoading: string;
  /** Said when nothing needs the person, runs or comes next. */
  statusQuiet: string;
  statusNeedsYou: string;
  statusWork: string;
  statusNext: string;
  statusLog: string;
  states: Record<FortressMemberState, string>;
  /** The mark on a need or a log line that is more than information. */
  levels: Record<"warn" | "error", string>;
}

/** Puts each `{name}` of `template` in place. A name without a value stays as it is. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (all, name: string) => (name in values ? String(values[name]) : all));
}

/** The form of `forms` the language uses for `count`, with the count filled in. */
export function plural(lang: string, forms: Plural, count: number): string {
  const category = new Intl.PluralRules(lang).select(count);
  return fill(forms[category] ?? forms.other, { count: count.toLocaleString(lang) });
}

/** "A, B and C" in the language's own way. */
export function listOf(lang: string, items: string[]): string {
  return new Intl.ListFormat(lang, { type: "conjunction" }).format(items);
}
