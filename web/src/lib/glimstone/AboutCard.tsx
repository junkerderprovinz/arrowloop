import { Fragment, useState, type ReactNode } from "react";
import { mailHref, offersMail, openInBrowser, runUpdateCheck, updateFace, updateStage, versionLink, type OpenUrl, type UpdateCheck, type UpdateVerdict, type VersionRow } from "../infoTile.ts";
import { Button } from "./Button.tsx";
import { Card } from "./Card.tsx";
import { InfoBubble } from "./InfoBubble.tsx";
import { ReadmeButton } from "./ReadmeButton.tsx";

// The Info tile, the last tile in Settings ("The Info tile and the About card"
// in design-language.md): the Version card with every version the app is made
// of and one button to its release notes and changes, the Help card with the
// ways to report something, and the About card with the maker's sentence and
// the give row. Each sentence sits directly above the buttons it asks for, and
// no card names a route no control on it can reach. Every string is passed in.

export type { UpdateCheck, VersionRow } from "../infoTile.ts";

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
  text: {
    title: string;
    /** The card's "(i)", such as what a click on a number opens. */
    hint?: string;
    unreleased: (version: string) => string;
    /** "Release notes". Only drawn with `onReleaseNotes` and without `whatsNew`. */
    releaseNotes?: string;
  };
  /** The app first, then the design language, then every component it ships.
   *  `hint` is what the component is, behind an (i) beside the name. */
  rows: (VersionRow & { hint?: string })[];
  /** "Check for updates" at the bottom of the card. Omit it and the card
   *  offers no check. */
  updateCheck?: UpdateCheck;
  /** How the app updates itself, such as a switch for automatic updates,
   *  drawn under the app's own row, the first. */
  settings?: ReactNode;
  /** Opens the app's window on the running version's release notes, for an
   *  app that marks no changes. */
  onReleaseNotes?: () => void;
  /** The app's own "New · n" button, wearing `IconWhatsNew` with the dot in
   *  front. It takes the place of "Release notes", so the card has one button there. */
  whatsNew?: ReactNode;
  openUrl?: OpenUrl;
  hueIndex?: number;
}

/** The first card: every version as a row, and the New or Release notes button and the update check under them. */
export function InfoVersionCard({
  text,
  rows,
  updateCheck,
  settings,
  onReleaseNotes,
  whatsNew,
  openUrl = openInBrowser,
  hueIndex,
}: InfoVersionCardProps) {
  const notes = !whatsNew && onReleaseNotes && text.releaseNotes;
  return (
    <Card data-glim="InfoVersionCard" title={text.title} hint={text.hint} hueIndex={hueIndex}>
      <ul className="glim-version-rows">
        {rows.map((row, i) => (
          <Fragment key={row.name}>
            <li className="glim-version-row">
              <span className="glim-version-name">
                <span className="glim-version-part flex items-center gap-1.5">
                  {row.name}
                  {row.hint && <InfoBubble tip={row.hint} />}
                </span>
                {row.sub && <span className="glim-version-sub">{row.sub}</span>}
              </span>
              <VersionNumber row={row} unreleased={text.unreleased} openUrl={openUrl} />
            </li>
            {i === 0 && settings && <li>{settings}</li>}
          </Fragment>
        ))}
      </ul>
      {(notes || whatsNew || updateCheck) && (
        <div className="glim-version-actions">
          {notes && <Button label={notes} labelKey="about.releaseNotes" onClick={onReleaseNotes} />}
          {whatsNew}
          {updateCheck && <UpdateCheckButton {...updateCheck} />}
        </div>
      )}
    </Card>
  );
}

/** The update check shows its verdict on itself, like a test button. */
function UpdateCheckButton(check: UpdateCheck) {
  const [verdict, setVerdict] = useState<UpdateVerdict>({ kind: "idle" });
  const [shake, setShake] = useState(0);
  const face = updateFace(verdict, check.text);

  return (
    <>
      <Button
        key={shake}
        label={face.label}
        labelKey={face.labelKey}
        tone={face.tone}
        stage={updateStage(check.text, face.label)}
        busy={verdict.kind === "busy"}
        onClick={() =>
          void runUpdateCheck(check, verdict, (v) => {
            setVerdict(v);
            if (v.kind === "failed") setShake((n) => n + 1);
          })
        }
        className={shake > 0 ? "glim-shake" : ""}
      />
      <span role="status" className="glim-sr-only">
        {face.announced}
      </span>
    </>
  );
}

/**
 * The number at a row's end, a link to its release page when it is a published
 * release. It has no underline; the ink lifts on hover.
 */
function VersionNumber({ row, unreleased, openUrl }: { row: VersionRow; unreleased: (version: string) => string; openUrl: OpenUrl }) {
  const { shown, released, href } = versionLink(row);
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

/** The second card: a sentence inviting a report, then GitHub, Email, the manual and the bug report. */
export function InfoHelpCard({
  text,
  repoUrl,
  repoGlyph,
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
  help: Omit<InfoHelpCardProps, "hueIndex">;
  about: Omit<InfoAboutCardProps, "hueIndex">;
  /** The Version card's rainbow position; the cards after it take the next ones. */
  hueIndex?: number;
  /** Data attributes for the tile, so a component built on it can name itself. */
  [data: `data-${string}`]: string | undefined;
}

/** The Info tile's cards in their fixed order, for the page that stacks them. */
export function InfoTile({ version, help, about, hueIndex, ...data }: InfoTileProps) {
  const at = (offset: number) => (hueIndex === undefined ? undefined : hueIndex + offset);
  return (
    <div data-glim="InfoTile" {...data} style={{ display: "contents" }}>
      <InfoVersionCard {...version} hueIndex={at(0)} />
      <InfoHelpCard {...help} hueIndex={at(1)} />
      <InfoAboutCard {...about} hueIndex={at(2)} />
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
  mailAddress?: string;
  mailGlyph?: ReactNode;
  openUrl?: (url: string) => void;
  hueIndex?: number;
}) {
  const rows: VersionRow[] = [
    ...(version ? [{ name: text.version, version, repoUrl }] : []),
    { name: "GlimStone", version: glimstoneVersion, repoUrl: glimstoneRepoUrl },
  ];
  return (
    <InfoTile
      data-glim="AboutCard"
      hueIndex={hueIndex}
      about={{ text, onCoffee, coffeeArt, onPaypal, paypalGlyph, onCrypto, cryptoGlyph }}
      version={{ text: { title: text.version, unreleased: text.unreleased }, rows, openUrl }}
      help={{
        text: {
          title: text.helpTitle,
          report: text.report,
          repoButton: text.repoButton,
          mailButton: text.mailButton,
          mailSubject: text.mailSubject,
        },
        repoUrl,
        repoGlyph,
        mailAddress,
        mailGlyph,
        openUrl,
      }}
    />
  );
}
