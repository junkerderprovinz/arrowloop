import type { ReactNode } from "react";

import { Button } from "./Button";
import { Card } from "./Card";

/**
 * The About card, in the order the design language lays down: what this is,
 * then the money with its own buttons, then the way to report something, then
 * the versions as a footer. It replaces an app's version footer rather than
 * joining one.
 *
 * Each sentence sits directly above the buttons it asks for, and the card never
 * names a route no control on it can reach. In the footer only the number is a
 * link, to its tag's release page; a build that is not a published release gets
 * no link. Every string is passed in.
 */
export function AboutCard({
  text,
  version,
  glimstoneVersion,
  repoUrl,
  repoGlyph,
  glimstoneRepoUrl,
  onCoffee,
  coffeeGlyph,
  cryptoGlyph,
  paypalGlyph,
  onPaypal,
  onCrypto,
  mailAddress,
  mailGlyph,
  openUrl = (url) => window.open(url, "_blank", "noopener,noreferrer"),
  hueIndex,
}: {
  /** The card's copy, in the app's own language. The mail button is drawn only
   *  when `report` names a mail route and `mailAddress` is set. */
  text: {
    title: string;
    body: string;
    coffee: string;
    coffeeButton: string;
    /** The second give button. Only drawn together with `onCrypto`. */
    cryptoButton?: string;
    /** The third. Only drawn together with `onPaypal`. */
    paypalButton?: string;
    report: string;
    repoButton: string;
    mailButton: string;
    mailSubject: string;
    version: string;
    unreleased: (version: string) => string;
  };
  /** The running build, read from the app's build stamp rather than typed in. */
  version: string | null;
  /** The GlimStone release this interface is built against. */
  glimstoneVersion: string;
  repoUrl: string;
  /**
   * The mark on the repository button, when its host has one. It is passed
   * rather than resolved by label key, because a rule keyed on "repo" would put
   * a forge's logo on settings that have nothing to do with it.
   */
  repoGlyph?: ReactNode;
  glimstoneRepoUrl: string;
  /** Opens the coffee window (CoffeeDialog), which stays inside the app. */
  onCoffee: () => void;
  /**
   * The marks on the give buttons, passed for the same reason as `repoGlyph`.
   * An app that passes nothing keeps whatever its own table resolves.
   */
  coffeeGlyph?: ReactNode;
  cryptoGlyph?: ReactNode;
  paypalGlyph?: ReactNode;
  /**
   * The envelope on the mail button. It is not a brand, but every button in
   * these rows carries a mark, and a row with one bare button reads as a
   * missing image.
   */
  mailGlyph?: ReactNode;
  /** Opens the PayPal window (PaypalDialog). Omit it where the maker takes no
   *  PayPal donations. */
  onPaypal?: () => void;
  /**
   * Opens the crypto window (CryptoDonateDialog), which stays inside the app.
   * Omit it and the card offers no crypto button.
   */
  onCrypto?: () => void;
  /** The workshop's own mailbox. Omit it and the card offers no mail route. */
  mailAddress?: string;
  /**
   * Opens the repository, the mail program and the release pages. An app
   * whose webview has no browser behind it passes its own way out.
   */
  openUrl?: (url: string) => void;
  hueIndex?: number;
}) {
  const wantsMail = /e-?mail/i.test(text.report) && Boolean(mailAddress);

  return (
    <Card title={text.title} hueIndex={hueIndex}>
      {/* No reading-width cap: a reading width belongs to a whole page, and a
          cap on this card alone reads as hand-set line breaks. */}
      <p className="text-sm text-carbon-textSub">{text.body}</p>

      <p className="text-sm text-carbon-textSub">{text.coffee}</p>
      {/* Every way to give sits in one row under its sentence, the two hosted
          payment routes first and the wallet, which needs no account, last. Each
          opens its own window inside the app. The brand classes take their
          colours from the brand block in reference/tokens.css. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          label={text.coffeeButton}
          labelKey="about.coffeeButton"
          glyph={coffeeGlyph}
          tone="neutral"
          className="glim-brand-btn glim-brand-coffee"
          onClick={onCoffee}
        />
        {onPaypal && text.paypalButton && (
          <Button
            label={text.paypalButton}
            labelKey="about.paypal"
            glyph={paypalGlyph}
            tone="neutral"
            className="glim-brand-btn glim-brand-paypal"
            onClick={onPaypal}
          />
        )}
        {onCrypto && text.cryptoButton && (
          <Button
            label={text.cryptoButton}
            labelKey="about.crypto"
            glyph={cryptoGlyph}
            tone="neutral"
            // The mark here is the bare letterform without its disc: the brand
            // class paints every path in one ink, and at 16px a disc reads as
            // an orange dot. The coin tiles in the donation window keep it.
            className="glim-brand-btn glim-brand-bitcoin"
            onClick={onCrypto}
          />
        )}
      </div>

      {/* Extra space above the second offer, so the give buttons do not pair
          with the wrong sentence. */}
      <p className="mt-2 text-sm text-carbon-textSub">{text.report}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          label={text.repoButton}
          labelKey="about.repo"
          glyph={repoGlyph}
          tone="neutral"
          className="glim-brand-btn glim-brand-github"
          onClick={() => openUrl(repoUrl)}
        />
        {wantsMail && (
          // Subject only: a prefilled body reads as a form to fill in. This
          // button reaches the app's own authors rather than a third party, so
          // `glim-brand-house` follows the user's accent and rainbow.
          <Button
            label={text.mailButton}
            labelKey="about.mail"
            glyph={mailGlyph}
            tone="neutral"
            className="glim-brand-btn glim-brand-house"
            onClick={() =>
              openUrl(`mailto:${mailAddress}?subject=${encodeURIComponent(text.mailSubject)}`)
            }
          />
        )}
      </div>

      {/* One line with a middle dot: this is one fact about one build. */}
      <p className="glim-num flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-carbon-textMuted">
        {version && (
          <VersionLink
            label={text.version}
            version={version}
            repo={repoUrl}
            unreleased={text.unreleased}
            openUrl={openUrl}
          />
        )}
        {version && <span aria-hidden="true">·</span>}
        <VersionLink
          label="GlimStone"
          version={glimstoneVersion}
          repo={glimstoneRepoUrl}
          unreleased={text.unreleased}
          openUrl={openUrl}
        />
      </p>
    </Card>
  );
}

/**
 * The tag behind a running version string: for `v8.3.1+feature-branch.59b73a6`
 * it is the part before the semver build metadata.
 */
export function releaseTag(version: string): string {
  const bare = version.split("+")[0].trim();
  if (!bare) return "";
  return bare.startsWith("v") ? bare : `v${bare}`;
}

/**
 * One `Label 1.2.3` pair where only the number is a link. It has no underline;
 * the ink lifts on hover.
 */
function VersionLink({
  label,
  version,
  repo,
  unreleased,
  openUrl,
}: {
  label: string;
  version: string;
  repo: string;
  unreleased: (version: string) => string;
  openUrl: (url: string) => void;
}) {
  const tag = releaseTag(version);
  const released = /^v\d+\.\d+\.\d+$/.test(tag);
  if (!released) {
    return (
      <span>
        {label} <span className="font-mono tabular-nums">{unreleased(version)}</span>
      </span>
    );
  }
  const href = `${repo}/releases/tag/${encodeURIComponent(tag)}`;
  return (
    <span>
      {label}{" "}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          openUrl(href);
        }}
        className="font-mono tabular-nums text-carbon-textMuted no-underline hover:text-carbon-text"
      >
        {version}
      </a>
    </span>
  );
}
