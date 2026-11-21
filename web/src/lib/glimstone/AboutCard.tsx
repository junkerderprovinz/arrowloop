import type { ReactNode } from "react";
import {
  autoSwitch,
  checkButton,
  componentRows,
  designRow,
  numberLink,
  updateAction,
  updateLine,
  whatsNewLabel,
  withApp,
  type ComponentRow,
  type ComponentsCardText,
  type UpdateRoute,
  type UpdateState,
  type VersionCardText,
} from "@glimstone/core";
import { mailHref, offersDiscord, offersMail, openInBrowser, versionLink, type OpenUrl, type VersionRow } from "../infoTile.ts";
import { Button } from "./Button.tsx";
import { Card } from "./Card.tsx";
import { InfoBubble } from "./InfoBubble.tsx";
import { ReadmeButton } from "./ReadmeButton.tsx";
import { Toggle } from "./Toggle.tsx";
import { GLIMSTONE_VERSION } from "./version.ts";

// The Info tile, the last tile in Settings ("The Info tile and the About card"
// in design-language.md): the Version card with the app, where its updates
// stand and what this version brought, the Components card with everything
// else that carries a number, the Help card with the ways to report something,
// and the About card with the maker's sentence and the give row. Every string
// is passed in, and a sentence that names the app takes it from `name`.

export type { ComponentRow, ComponentsCardText, UpdateRoute, UpdateState, VersionCardText } from "@glimstone/core";
export type { VersionRow } from "../infoTile.ts";

export interface InfoAboutCardProps {
  text: {
    title: string;
    body: string;
    coffee: string;
    /** The coffee button's accessible name; its artwork carries the words. */
    coffeeButton: string;
    /** The second give button. Only drawn together with `onPaypal`. */
    paypalButton?: string;
    /** The third. Only drawn together with `onCrypto`. */
    cryptoButton?: string;
  };
  /** Opens the coffee window (CoffeeDialog), which stays inside the app. */
  onCoffee: () => void;
  /** Buy Me a Coffee's own button artwork, `COFFEE_BUTTON_SVG` from appMarks.ts. */
  coffeeArt: ReactNode;
  /** Opens the PayPal window (PaypalDialog). Omit it where the maker takes no
   *  PayPal donations. */
  onPaypal?: () => void;
  /**
   * The marks on the other give buttons. They are passed rather than resolved
   * by label key, because a rule keyed on "crypto" would put a currency's
   * symbol on settings that have nothing to do with it.
   */
  paypalGlyph?: ReactNode;
  /** Opens the crypto window (CryptoDonateDialog). Omit it and the card offers
   *  no crypto button. */
  onCrypto?: () => void;
  cryptoGlyph?: ReactNode;
  hueIndex?: number;
}

/** The last card of the Info tile: who made the app, then the give row. */
export function InfoAboutCard({
  text,
  onCoffee,
  coffeeArt,
  onPaypal,
  paypalGlyph,
  onCrypto,
  cryptoGlyph,
  hueIndex,
}: InfoAboutCardProps) {
  return (
    <Card data-glim="InfoAboutCard" title={text.title} hueIndex={hueIndex}>
      {/* No reading-width cap: a reading width belongs to a whole page, and a
          cap on this card alone reads as hand-set line breaks. */}
      <p className="glim-info-text">{text.body}</p>

      <p className="glim-info-text">{text.coffee}</p>
      {/* The hosted payment routes first and the wallet, which needs no
          account, last. One line per button, as on the README, so nothing
          moves up under the pointer. */}
      <div className="glim-readme-btn-rows glim-about-give">
        <ReadmeButton brand="coffee" parts={[{ name: text.coffeeButton, onClick: onCoffee }]} art={coffeeArt} />
        {onPaypal && text.paypalButton && (
          <ReadmeButton
            brand="paypal"
            parts={[{ name: text.paypalButton, onClick: onPaypal }]}
            mark={paypalGlyph}
            markClass="glim-paypal-mark"
          />
        )}
        {onCrypto && text.cryptoButton && (
          // The bare letterform without its disc: at button size a disc reads
          // as an orange dot. The coin tiles in the donation window keep it.
          <ReadmeButton
            brand="bitcoin"
            parts={[{ name: text.cryptoButton, onClick: onCrypto }]}
            mark={cryptoGlyph}
            markClass="glim-bitcoin-mark"
          />
        )}
      </div>
    </Card>
  );
}

export interface InfoVersionCardProps {
  /** `componentText(lang).versionCard`, or the app's own words in its shape. */
  text: VersionCardText;
  /** The app's name, which fills "{app}" in the card's sentences. */
  name: string;
  /** Read from the build, never typed in. */
  version: string;
  /** The repository whose newest release the number opens. */
  repoUrl?: string;
  /** How the app gets a new version, which decides the one action. */
  route: UpdateRoute;
  /** Where the updates stand. The app finds out; the card shows it. */
  state: UpdateState;
  /** "Check for updates". A store app passes none. */
  onCheck?: () => void;
  /** Fetches and installs the new version, or leads to the host's plugin page. */
  onUpdate?: () => void;
  /** Starts the downloaded version. */
  onRestart?: () => void;
  /** Where a container's update instructions live. */
  guideUrl?: string;
  /** Opens the app's window of what changed, a card per release with its notes. */
  onWhatsNew: () => void;
  /** How many marked changes are still unseen. */
  unseen?: number;
  /** The switch under the state. Left out, the card draws none. */
  autoUpdate?: boolean;
  onAutoUpdateChange?: (on: boolean) => void;
  openUrl?: OpenUrl;
  hueIndex?: number;
}

/**
 * The first card: the app's name and version, the switch, and a last row with
 * where the updates stand at its start and the buttons at its end: "What's
 * new", "Check for updates" while there is something to look for, and the one
 * action once there is something to do.
 */
export function InfoVersionCard({
  text,
  name,
  version,
  repoUrl,
  route,
  state,
  onCheck,
  onUpdate,
  onRestart,
  guideUrl,
  onWhatsNew,
  unseen = 0,
  autoUpdate,
  onAutoUpdateChange,
  openUrl = openInBrowser,
  hueIndex,
}: InfoVersionCardProps) {
  const face = updateLine(state, text);
  const action = updateAction(route, state, text);
  const toggle = autoSwitch(route, text);
  const check = checkButton(route, state);
  const press = () => {
    if (action?.kind === "restart") onRestart?.();
    else if (action?.kind === "guide") guideUrl && openUrl(guideUrl);
    else onUpdate?.();
  };
  return (
    <Card data-glim="InfoVersionCard" title={text.title} hint={withApp(text.hint, name)} hueIndex={hueIndex}>
      <div className="glim-version-head">
        <span className="glim-version-app">{name}</span>
        <VersionNumber row={{ name, version, repoUrl }} unreleased={text.unreleased} openUrl={openUrl} />
      </div>
      {toggle && autoUpdate !== undefined && (
        <SwitchRow label={toggle.label} hint={withApp(toggle.hint, name)} checked={autoUpdate} onChange={(on) => onAutoUpdateChange?.(on)} />
      )}
      {state.kind === "downloading" && (
        <div className="glim-version-progress" role="progressbar" aria-label={face.line} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent}>
          <span style={{ width: `${state.percent}%` }} />
        </div>
      )}
      <div className="glim-version-foot">
        <p className="glim-version-state" data-tone={face.tone} role="status">
          <span className="glim-version-line">{face.line}</span>
          {face.note && <span className="glim-version-note">{face.note}</span>}
        </p>
        <div className="glim-version-actions">
          <Button
            label={whatsNewLabel(text, unseen)}
            labelKey="version.whatsNew"
            before={<span className="glim-version-dot" data-unseen={unseen > 0 ? "" : undefined} aria-hidden="true" />}
            onClick={onWhatsNew}
          />
          {check && onCheck && <Button label={text.check} labelKey="version.check" busy={check.busy} disabled={check.busy} onClick={onCheck} />}
          {action && <Button label={action.label} labelKey={action.labelKey} tone={action.kind === "guide" ? "neutral" : "accent"} onClick={press} />}
        </div>
      </div>
    </Card>
  );
}

export interface InfoComponentsCardProps {
  /** `componentText(lang).componentsCard`, or the app's own words in its shape. */
  text: ComponentsCardText;
  /** The app's name, which fills "{app}" in the card's sentences. */
  name: string;
  /** The app's own parts, the programs it brings along and, for a desktop
   *  build, its installer. The card adds the design language and sorts them. */
  rows: ComponentRow[];
  /** The switch for updating the components. Left out, the card draws none. */
  autoUpdate?: boolean;
  onAutoUpdateChange?: (on: boolean) => void;
  /** "Update components" at the foot of the card. Omit it where the app updates none. */
  onUpdate?: () => void;
  updating?: boolean;
  openUrl?: OpenUrl;
  hueIndex?: number;
}

/**
 * The second card: every version the app is made of or brings along, as plain
 * numbers in a fixed order, with a status and one action on a row that needs one.
 */
export function InfoComponentsCard({
  text,
  name,
  rows,
  autoUpdate,
  onAutoUpdateChange,
  onUpdate,
  updating = false,
  openUrl = openInBrowser,
  hueIndex,
}: InfoComponentsCardProps) {
  // The design language's number is the one these copied files carry.
  const design = { ...designRow(text), version: GLIMSTONE_VERSION };
  return (
    <Card data-glim="InfoComponentsCard" title={text.title} hint={withApp(text.hint, name)} hueIndex={hueIndex}>
      <ul className="glim-version-rows">
        {componentRows([...rows, design]).map((row) => (
          <li key={row.name} className="glim-version-row">
            <span className="glim-version-name">
              <span className="glim-version-part">{row.name}</span>
              {row.hint && <InfoBubble tip={row.hint} />}
            </span>
            {row.status && (
              <span className="glim-version-status" data-tone={row.tone}>
                {row.status}
              </span>
            )}
            {row.action && <Button label={row.action.label} labelKey={row.action.labelKey} onClick={row.action.onClick} />}
            <VersionNumber row={row} unreleased={text.unreleased} openUrl={openUrl} />
          </li>
        ))}
      </ul>
      {autoUpdate !== undefined && (
        <SwitchRow label={text.auto} hint={withApp(text.autoHint, name)} checked={autoUpdate} onChange={(on) => onAutoUpdateChange?.(on)} />
      )}
      {onUpdate && (
        <div className="glim-version-actions">
          <Button label={text.update} labelKey="components.update" busy={updating} onClick={onUpdate} />
        </div>
      )}
    </Card>
  );
}

/** A switch on a row of its own, its name and (i) at the start and the switch at the end. */
function SwitchRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span data-glim-label={label} className="flex items-center gap-1.5 text-body text-carbon-text">
        {label}
        <InfoBubble tip={hint} />
      </span>
      <Toggle checked={checked} onChange={onChange} label={label} hideLabel />
    </div>
  );
}

/**
 * A number that reads as plain text and opens the newest release of its
 * project. It takes the accent's ink under the pointer, never an underline.
 */
function VersionNumber({ row, unreleased, openUrl }: { row: ComponentRow; unreleased: (version: string) => string; openUrl: OpenUrl }) {
  const { shown, released, href } = numberLink(row);
  if (!href) return <span className="glim-num glim-version-number">{released ? shown : unreleased(shown)}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        openUrl(href);
      }}
      className="glim-num glim-version-number"
    >
      {shown}
    </a>
  );
}

export interface InfoHelpCardProps {
  text: {
    title?: string;
    /** The card's "(i)", such as what the bug report holds. */
    hint?: string;
    report: string;
    repoButton: string;
    /** "Discord". Only drawn together with `discordUrl`. */
    discordButton?: string;
    mailButton: string;
    mailSubject: string;
    /** "Bug report". Only drawn together with `onBugReport`. */
    bugReport?: string;
    /** The bug report's second line, "Download". */
    bugReportSub?: string;
    /** "Manual". Only drawn together with `manualUrl`. */
    manual?: string;
    /** The manual's second line, "Open". */
    manualSub?: string;
  };
  repoUrl: string;
  /** The mark on the repository button, passed for the same reason as the
   *  give buttons' marks. */
  repoGlyph?: ReactNode;
  /** An invite to the app's Discord server, for an app that takes its
   *  questions there rather than by mail. */
  discordUrl?: string;
  /** `IconDiscord`, Discord's own mark. */
  discordGlyph?: ReactNode;
  /** The workshop's own mailbox. Omit it and the card offers no mail route. */
  mailAddress?: string;
  /** The envelope, `MAIL_SVG` from appMarks.ts, which opens under the pointer. */
  mailGlyph?: ReactNode;
  /** The app's handbook. Omit it where the app has none; the README is not a
   *  manual. */
  manualUrl?: string;
  /** The book, `MANUAL_SVG` from appMarks.ts, which opens under the pointer. */
  manualGlyph?: ReactNode;
  /** Downloads the instance's logs and settings as one file, without
   *  passwords, keys or credentials. */
  onBugReport?: () => void;
  /** `IconDiagnostics`, the bug. */
  bugGlyph?: ReactNode;
  openUrl?: OpenUrl;
  hueIndex?: number;
}

/** The second card: a sentence inviting a report, then GitHub, Discord, Email, the manual and the bug report. */
export function InfoHelpCard({
  text,
  repoUrl,
  repoGlyph,
  discordUrl,
  discordGlyph,
  mailAddress,
  mailGlyph,
  manualUrl,
  manualGlyph,
  onBugReport,
  bugGlyph,
  openUrl = openInBrowser,
  hueIndex,
}: InfoHelpCardProps) {
  const wantsMail = offersMail(text.report, mailAddress);
  const wantsDiscord = offersDiscord(text.report, discordUrl) && Boolean(text.discordButton);

  return (
    <Card data-glim="InfoHelpCard" title={text.title} hint={text.hint} hueIndex={hueIndex}>
      <p className="glim-info-text">{text.report}</p>
      <div className="glim-readme-btn-rows">
        <ReadmeButton
          brand="github"
          parts={[{ name: text.repoButton, onClick: () => openUrl(repoUrl) }]}
          mark={repoGlyph}
          markClass="glim-github-mark"
        />
        {wantsDiscord && (
          <ReadmeButton
            brand="discord"
            parts={[{ name: text.discordButton!, onClick: () => openUrl(discordUrl!) }]}
            mark={discordGlyph}
            markClass="glim-discord-mark"
          />
        )}
        {wantsMail && (
          // This button reaches the app's own authors rather than a third
          // party, so it follows the user's accent and rainbow.
          <ReadmeButton
            brand="house"
            parts={[
              {
                name: text.mailButton,
                onClick: () => openUrl(mailHref(mailAddress!, text.mailSubject)),
              },
            ]}
            mark={mailGlyph}
            markClass="glim-house-mark"
          />
        )}
        {manualUrl && text.manual && (
          // The README's docs button, its book and its yellow.
          <ReadmeButton
            brand="docs"
            parts={[{ name: text.manual, sub: text.manualSub, onClick: () => openUrl(manualUrl) }]}
            mark={manualGlyph}
            markClass="glim-docs-mark"
          />
        )}
        {onBugReport && text.bugReport && (
          // The file goes with an issue on GitHub, so it lights up beside it.
          <ReadmeButton
            brand="github"
            parts={[{ name: text.bugReport, sub: text.bugReportSub, onClick: onBugReport }]}
            mark={bugGlyph}
          />
        )}
      </div>
    </Card>
  );
}

export interface InfoTileProps {
  version: Omit<InfoVersionCardProps, "hueIndex">;
  components: Omit<InfoComponentsCardProps, "hueIndex">;
  help: Omit<InfoHelpCardProps, "hueIndex">;
  about: Omit<InfoAboutCardProps, "hueIndex">;
  /** The Version card's rainbow position; the cards after it take the next ones. */
  hueIndex?: number;
  /** Data attributes for the tile, so a component built on it can name itself. */
  [data: `data-${string}`]: string | undefined;
}

/** The Info tile's cards in their fixed order, Version, Components, Help and About, for the page that stacks them. */
export function InfoTile({ version, components, help, about, hueIndex, ...data }: InfoTileProps) {
  const at = (offset: number) => (hueIndex === undefined ? undefined : hueIndex + offset);
  return (
    <div data-glim="InfoTile" {...data} style={{ display: "contents" }}>
      <InfoVersionCard {...version} hueIndex={at(0)} />
      <InfoComponentsCard {...components} hueIndex={at(1)} />
      <InfoHelpCard {...help} hueIndex={at(2)} />
      <InfoAboutCard {...about} hueIndex={at(3)} />
    </div>
  );
}

/**
 * The 3.2.0 props of the single About card, laid out as the Info tile: the
 * About card under `text.title`, the Version card under `text.version` with the
 * app and GlimStone as its rows, and the Help card.
 *
 * @deprecated Use `InfoTile`, which adds the version rows' sub-lines, the
 * other components, "Check for updates" and the bug report.
 */
export function AboutCard({
  text,
  version,
  glimstoneVersion,
  repoUrl,
  repoGlyph,
  glimstoneRepoUrl,
  onCoffee,
  coffeeArt,
  cryptoGlyph,
  paypalGlyph,
  onPaypal,
  onCrypto,
  discordUrl,
  discordGlyph,
  mailAddress,
  mailGlyph,
  openUrl = openInBrowser,
  hueIndex,
}: {
  text: {
    title: string;
    body: string;
    coffee: string;
    coffeeButton: string;
    cryptoButton?: string;
    paypalButton?: string;
    report: string;
    repoButton: string;
    discordButton?: string;
    mailButton: string;
    mailSubject: string;
    version: string;
    unreleased: (version: string) => string;
    /** The Help card's heading. Without it the card draws none. */
    helpTitle?: string;
  };
  version: string | null;
  glimstoneVersion: string;
  repoUrl: string;
  repoGlyph?: ReactNode;
  glimstoneRepoUrl: string;
  onCoffee: () => void;
  coffeeArt: ReactNode;
  cryptoGlyph?: ReactNode;
  paypalGlyph?: ReactNode;
  onPaypal?: () => void;
  onCrypto?: () => void;
  discordUrl?: string;
  discordGlyph?: ReactNode;
  mailAddress?: string;
  mailGlyph?: ReactNode;
  openUrl?: (url: string) => void;
  hueIndex?: number;
}) {
  const rows: VersionRow[] = [
    ...(version ? [{ name: text.version, version, repoUrl }] : []),
    { name: "GlimStone", version: glimstoneVersion, repoUrl: glimstoneRepoUrl },
  ];
  const at = (offset: number) => (hueIndex === undefined ? undefined : hueIndex + offset);
  return (
    <div data-glim="AboutCard" style={{ display: "contents" }}>
      <Card title={text.version} hueIndex={at(0)}>
        <ul className="glim-version-rows">
          {rows.map((row) => {
            const { shown, released, href } = versionLink(row);
            return (
              <li key={row.name} className="glim-version-row">
                <span className="glim-version-name">
                  <span className="glim-version-part">{row.name}</span>
                </span>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="glim-num glim-version-number">
                    {shown}
                  </a>
                ) : (
                  <span className="glim-num glim-version-number">{released ? shown : text.unreleased(shown)}</span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      <InfoHelpCard
        hueIndex={at(1)}
        text={{
          title: text.helpTitle,
          report: text.report,
          repoButton: text.repoButton,
          discordButton: text.discordButton,
          mailButton: text.mailButton,
          mailSubject: text.mailSubject,
        }}
        repoUrl={repoUrl}
        repoGlyph={repoGlyph}
        discordUrl={discordUrl}
        discordGlyph={discordGlyph}
        mailAddress={mailAddress}
        mailGlyph={mailGlyph}
        openUrl={openUrl}
      />
      <InfoAboutCard hueIndex={at(2)} text={text} onCoffee={onCoffee} coffeeArt={coffeeArt} onPaypal={onPaypal} paypalGlyph={paypalGlyph} onCrypto={onCrypto} cryptoGlyph={cryptoGlyph} />
    </div>
  );
}
