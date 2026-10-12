import { useState, type ReactNode } from "react";

import { groupStage } from "../controls";
import { Button, type ButtonTone } from "./Button";
import { Card } from "./Card";
import { ReadmeButton } from "./ReadmeButton";

// The Info tile, the last tile in Settings ("The Info tile and the About card"
// in design-language.md): the Version card with every version the app is made
// of, the Help card with the ways to report something, the app's own What's new
// card where it has one, and the About card with the maker's sentence and the
// give row. Each sentence sits directly above the buttons it asks for, and no
// card names a route no control on it can reach. Every string is passed in.

type OpenUrl = (url: string) => void;

const openInBrowser: OpenUrl = (url) => window.open(url, "_blank", "noopener,noreferrer");

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
    <Card title={text.title} hueIndex={hueIndex}>
      {/* No reading-width cap: a reading width belongs to a whole page, and a
          cap on this card alone reads as hand-set line breaks. */}
      <p className="text-sm text-carbon-textSub">{text.body}</p>

      <p className="text-sm text-carbon-textSub">{text.coffee}</p>
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

export interface VersionRow {
  /** The component's name at the row's start. It is not a link. */
  name: string;
  /** What the component is, as a sub-line under the name. */
  sub?: string;
  /** Read from the build or from the copied files that own it, never typed in. */
  version: string;
  /** The repository whose release page the number opens. Without one the
   *  number is plain text. */
  repoUrl?: string;
  /** Stands in front of the tag where one repository ships several artefacts,
   *  such as `mobile/`. */
  tagPrefix?: string;
}

export interface UpdateCheck {
  /**
   * Checks every listed component at once and resolves to how many have a
   * newer release. It rejects when the check cannot run; the app puts the
   * reason in a toast, and the button shakes.
   */
  run: () => Promise<number>;
  text: {
    check: string;
    upToDate: string;
    updatesFound: (count: number) => string;
    checkFailed: string;
  };
}

export interface InfoVersionCardProps {
  text: {
    title: string;
    /** The card's "(i)", such as what a click on a number opens. */
    hint?: string;
    unreleased: (version: string) => string;
  };
  /** The app first, then the design language, then every component it ships. */
  rows: VersionRow[];
  /** "Check for updates" at the bottom of the card. Omit it and the card
   *  offers no check. */
  updateCheck?: UpdateCheck;
  openUrl?: OpenUrl;
  hueIndex?: number;
}

/** The first card: every version as a row, and the update check under them. */
export function InfoVersionCard({ text, rows, updateCheck, openUrl = openInBrowser, hueIndex }: InfoVersionCardProps) {
  return (
    <Card title={text.title} hint={text.hint} hueIndex={hueIndex}>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 flex-col">
              <span className="text-sm text-carbon-text">{row.name}</span>
              {row.sub && <span className="text-subline text-carbon-textMuted">{row.sub}</span>}
            </span>
            <VersionNumber row={row} unreleased={text.unreleased} openUrl={openUrl} />
          </li>
        ))}
      </ul>
      {updateCheck && (
        <div className="flex justify-end">
          <UpdateCheckButton {...updateCheck} />
        </div>
      )}
    </Card>
  );
}

type Verdict = { kind: "idle" | "busy" | "current" | "failed" } | { kind: "found"; count: number };

/** The update check shows its verdict on itself, like a test button. */
function UpdateCheckButton({ run, text }: UpdateCheck) {
  const [verdict, setVerdict] = useState<Verdict>({ kind: "idle" });
  const [shake, setShake] = useState(0);

  const check = async () => {
    if (verdict.kind === "busy") return;
    setVerdict({ kind: "busy" });
    try {
      const count = await run();
      setVerdict(count > 0 ? { kind: "found", count } : { kind: "current" });
    } catch {
      setVerdict({ kind: "failed" });
      setShake((n) => n + 1);
    }
  };

  const face: { label: string; labelKey: string; tone: ButtonTone } =
    verdict.kind === "current"
      ? { label: text.upToDate, labelKey: "about.upToDate", tone: "ok" }
      : verdict.kind === "found"
        ? { label: text.updatesFound(verdict.count), labelKey: "about.updatesFound", tone: "warn" }
        : verdict.kind === "failed"
          ? { label: text.checkFailed, labelKey: "about.checkFailed", tone: "danger" }
          : { label: text.check, labelKey: "about.checkUpdates", tone: "neutral" };
  // One width for every verdict, so the button does not jump when its word
  // changes.
  const stage = groupStage([text.check, text.upToDate, text.updatesFound(2), text.checkFailed, face.label]);
  const announced = verdict.kind === "idle" || verdict.kind === "busy" ? "" : face.label;

  return (
    <>
      <Button
        key={shake}
        label={face.label}
        labelKey={face.labelKey}
        tone={face.tone}
        stage={stage}
        busy={verdict.kind === "busy"}
        onClick={() => void check()}
        className={shake > 0 ? "glim-shake" : ""}
      />
      <span role="status" className="sr-only">
        {announced}
      </span>
    </>
  );
}

/**
 * The tag behind a running version string: for `v8.3.1+feature-branch.59b73a6`
 * it is the part before the semver build metadata.
 */
export function releaseTag(version: string): string {
  const bare = (version.split("+")[0] ?? "").trim();
  if (!bare) return "";
  return bare.startsWith("v") ? bare : `v${bare}`;
}

/**
 * The number at a row's end, a link to its release page when it is a published
 * release. It has no underline; the ink lifts on hover.
 */
function VersionNumber({
  row,
  unreleased,
  openUrl,
}: {
  row: VersionRow;
  unreleased: (version: string) => string;
  openUrl: OpenUrl;
}) {
  const tag = releaseTag(row.version);
  const released = /^v\d+\.\d+\.\d+$/.test(tag);
  if (!released) {
    return <span className="glim-num shrink-0 text-sm text-carbon-textSub">{unreleased(row.version)}</span>;
  }
  if (!row.repoUrl) {
    return <span className="glim-num shrink-0 text-sm text-carbon-textSub">{row.version}</span>;
  }
  const href = `${row.repoUrl}/releases/tag/${encodeURIComponent(`${row.tagPrefix ?? ""}${tag}`)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        openUrl(href);
      }}
      className="glim-num shrink-0 text-sm text-carbon-textSub no-underline hover:text-carbon-text"
    >
      {row.version}
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
  };
  repoUrl: string;
  /** The mark on the repository button, passed for the same reason as the
   *  give buttons' marks. */
  repoGlyph?: ReactNode;
  /** The workshop's own mailbox. Omit it and the card offers no mail route. */
  mailAddress?: string;
  /** The envelope, `MAIL_SVG` from appMarks.ts, which opens under the pointer. */
  mailGlyph?: ReactNode;
  /** Downloads the instance's logs and settings as one file, without
   *  passwords, keys or credentials. */
  onBugReport?: () => void;
  /** `IconDiagnostics`, the bug. */
  bugGlyph?: ReactNode;
  openUrl?: OpenUrl;
  hueIndex?: number;
}

/** The second card: a sentence inviting a report, then GitHub, Email and the bug report. */
export function InfoHelpCard({
  text,
  repoUrl,
  repoGlyph,
  mailAddress,
  mailGlyph,
  onBugReport,
  bugGlyph,
  openUrl = openInBrowser,
  hueIndex,
}: InfoHelpCardProps) {
  const wantsMail = /e-?mail/i.test(text.report) && Boolean(mailAddress);

  return (
    <Card title={text.title} hint={text.hint} hueIndex={hueIndex}>
      <p className="text-sm text-carbon-textSub">{text.report}</p>
      <div className="glim-readme-btn-rows">
        <ReadmeButton
          brand="github"
          parts={[{ name: text.repoButton, onClick: () => openUrl(repoUrl) }]}
          mark={repoGlyph}
          markClass="glim-github-mark"
        />
        {wantsMail && (
          // Subject only: a prefilled body reads as a form to fill in. This
          // button reaches the app's own authors rather than a third party, so
          // it follows the user's accent and rainbow.
          <ReadmeButton
            brand="house"
            parts={[
              {
                name: text.mailButton,
                onClick: () => openUrl(`mailto:${mailAddress}?subject=${encodeURIComponent(text.mailSubject)}`),
              },
            ]}
            mark={mailGlyph}
            markClass="glim-house-mark"
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
  /** The app's own What's new card. It takes the rainbow position after Help's,
   *  and About moves one further. */
  whatsNew?: ReactNode;
  about: Omit<InfoAboutCardProps, "hueIndex">;
  /** The Version card's rainbow position; the cards after it take the next ones. */
  hueIndex?: number;
}

/** The Info tile's cards in their fixed order, for the page that stacks them. */
export function InfoTile({ version, help, whatsNew, about, hueIndex }: InfoTileProps) {
  const at = (offset: number) => (hueIndex === undefined ? undefined : hueIndex + offset);
  return (
    <>
      <InfoVersionCard {...version} hueIndex={at(0)} />
      <InfoHelpCard {...help} hueIndex={at(1)} />
      {whatsNew}
      <InfoAboutCard {...about} hueIndex={at(whatsNew ? 3 : 2)} />
    </>
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
