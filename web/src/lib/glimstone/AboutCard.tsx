import type { ReactNode } from "react";

import { Button } from "./Button";
import { Card } from "./Card";

/**
 * The About card, in the order the design language lays down for it: what this
 * is, then the money with its own button, then the way to report something with
 * its own buttons, then the versions as a footer.
 *
 * It REPLACES a version footer rather than joining one. That is the failure mode
 * worth naming, because both are individually defensible and the result is one
 * number in two type sizes twelve pixels apart.
 *
 * Two rules the order encodes, and they are the whole point of shipping this as
 * a component rather than as prose:
 *
 * - **Each sentence sits directly above the thing it asks for.** Three sentences
 *   stacked over one row of buttons reads as a form; a sentence with its own
 *   button under it reads as one offer.
 * - **Never name a route no control on the card can reach.** If the sentence
 *   mentions e-mail, there is a mail button; if there is no address yet, the
 *   sentence does not mention one. A contact route that reaches nowhere is worse
 *   than none, because somebody writes and then waits.
 *
 * Only the NUMBER in the footer is a link, and it points at its own tag's
 * release page: a version answers "which build is this", and the question
 * straight after is always "and what changed". A build that is not a published
 * release gets no link at all — a link to a tag page that 404s is worse than
 * plain text.
 *
 * Every string is passed in. The card knows the order; the app knows its own
 * language, its own product name and its own addresses.
 */
export function AboutCard({
  text,
  version,
  glimstoneVersion,
  repoUrl,
  repoGlyph,
  glimstoneRepoUrl,
  coffeeUrl,
  coffeeGlyph,
  cryptoGlyph,
  paypalGlyph,
  paypalUrl,
  onCrypto,
  mailAddress,
  hueIndex,
}: {
  /** The card's copy, in the app's own language. `report` decides whether the
   *  mail button may exist at all: it is drawn only when the sentence names a
   *  mail route AND `mailAddress` is set. */
  text: {
    title: string;
    body: string;
    coffee: string;
    coffeeButton: string;
    /** The second give button. Only drawn together with `onCrypto`. */
    cryptoButton?: string;
    /** The third. Only drawn together with `paypalUrl`. */
    paypalButton?: string;
    report: string;
    repoButton: string;
    mailButton: string;
    mailSubject: string;
    version: string;
    unreleased: (version: string) => string;
  };
  /** The running build, read from the app's own build stamp — never typed into
   *  the card, since a number written down twice disagrees with itself the day
   *  one of them is bumped. */
  version: string | null;
  /** The GlimStone release this interface is built against. Bumped by hand when
   *  the reference files are re-copied, because the files are copied by hand. */
  glimstoneVersion: string;
  repoUrl: string;
  /**
   * The mark on the repository button, when the host it points at has one.
   *
   * Passed rather than resolved, and that is the rule rather than a
   * convenience. A brand mark must never be reachable BY PATTERN: a glyph rule
   * keyed on "repo" would put GitHub's logo on repository settings that have
   * nothing to do with GitHub, and on the day a project moves to a different
   * forge the logo would follow it there and be wrong. So the app names its
   * own forge at the one call site that means it, and a project hosted
   * somewhere without a mark passes nothing and keeps the generic link glyph.
   *
   * jdp: "der github button soll das github logo haben."
   */
  repoGlyph?: ReactNode;
  glimstoneRepoUrl: string;
  coffeeUrl: string;
  /**
   * The mark on the give buttons, where the route belongs to a named company.
   *
   * Passed rather than resolved, for the same reason as `repoGlyph`: a brand
   * must never be reachable BY PATTERN. A glyph rule keyed on "coffee" would
   * put one company's cup on anything that mentions coffee, and one keyed on
   * "crypto" would put a currency's symbol on settings that have nothing to do
   * with it. An app that passes nothing keeps whatever its own table resolves.
   */
  coffeeGlyph?: ReactNode;
  cryptoGlyph?: ReactNode;
  paypalGlyph?: ReactNode;
  /**
   * A hosted payment page (PayPal.Me and the like). Omitted where none exists.
   *
   * The card's own rule applied to a route rather than to a sentence: never
   * offer a control that reaches nowhere. Such a link is usually created once
   * and cannot be renamed afterwards, so an app hands one over only when it
   * really has it.
   */
  paypalUrl?: string;
  /**
   * Open the crypto window (CryptoDonateDialog). Omit it and the card offers
   * the coffee alone.
   *
   * A handler rather than a URL, because this route does not leave the app:
   * the addresses, the QR and the copy button are all in a house window, which
   * is the whole reason it is worth offering beside a hosted donation page.
   */
  onCrypto?: () => void;
  /** The workshop's own mailbox. Omit it and the card offers no mail route. */
  mailAddress?: string;
  hueIndex?: number;
}) {
  const wantsMail = /e-?mail/i.test(text.report) && Boolean(mailAddress);
  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

  return (
    <Card title={text.title} hueIndex={hueIndex}>
      {/* No reading-width cap on the card's own prose. It carried max-w-2xl
          (42rem) until 1.8.1, which is a defensible typographic width in the
          abstract and looked wrong here for a concrete reason: it is the ONLY
          capped text on its page. Every other card lets its sentences run the
          card, so three paragraphs stopping two thirds of the way across read
          as hand-set line breaks rather than as a measure. Reported exactly
          that way ("in der übercard sind künstliche Zeilenumbrüche") and
          measured before believing it: 672px of text in a 1244px card.

          The rule that follows, and it is the reusable half: a reading width
          is a property of a PAGE, never of one card on it. Cap all the prose
          or none of it. */}
      <p className="text-sm text-carbon-textSub">{text.body}</p>

      <p className="text-sm text-carbon-textSub">{text.coffee}</p>
      {/* One sentence, and under it every way to give. Two of them where the
          app offers crypto as well, and they are two because they reach
          different people: the coffee takes a card, the crypto window takes
          what somebody already holds in a wallet and shows no name at either
          end. Both stay in THIS row rather than getting a row of their own
          further down, which is the card's own rule — a sentence sits directly
          above the thing it asks for, and a second row reads as a second,
          unrelated offer. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          label={text.coffeeButton}
          labelKey="about.coffeeButton"
          glyph={coffeeGlyph}
          tone="neutral"
          onClick={() => open(coffeeUrl)}
        />
        {onCrypto && text.cryptoButton && (
          <Button
            label={text.cryptoButton}
            labelKey="about.crypto"
            glyph={cryptoGlyph}
            tone="neutral"
            onClick={onCrypto}
          />
        )}
        {paypalUrl && text.paypalButton && (
          <Button
            label={text.paypalButton}
            labelKey="about.paypal"
            glyph={paypalGlyph}
            tone="neutral"
            onClick={() => open(paypalUrl)}
          />
        )}
      </div>

      {/* One extra step of space above this line, and only above this one. The
          card holds two offers, and without the break the coffee button sits as
          close to the next sentence as to the one it belongs to, so the eye
          pairs it with the wrong text. */}
      <p className="mt-2 text-sm text-carbon-textSub">{text.report}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          label={text.repoButton}
          labelKey="about.repo"
          glyph={repoGlyph}
          tone="neutral"
          onClick={() => open(repoUrl)}
        />
        {wantsMail && (
          // Subject only, never a body: a prefilled body reads as a form to
          // fill in, and this is meant to be a message somebody writes.
          <Button
            label={text.mailButton}
            labelKey="about.mail"
            tone="neutral"
            onClick={() =>
              open(`mailto:${mailAddress}?subject=${encodeURIComponent(text.mailSubject)}`)
            }
          />
        )}
      </div>

      {/* The footer. One line with a middle dot, not two rows: two rows read as
          two facts of equal weight that happen to sit together, and this is one
          fact about one build. */}
      <p className="glim-num flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-carbon-textMuted">
        {version && (
          <VersionLink label={text.version} version={version} repo={repoUrl} unreleased={text.unreleased} />
        )}
        {version && <span aria-hidden="true">·</span>}
        <VersionLink
          label="GlimStone"
          version={glimstoneVersion}
          repo={glimstoneRepoUrl}
          unreleased={text.unreleased}
        />
      </p>
    </Card>
  );
}

/**
 * The tag behind a running version string.
 *
 * A build stamps `v8.3.1+feature-branch.59b73a6`; the tag is the part before the
 * build metadata, which is exactly what semver says the "+" means. Derived from
 * the version rather than kept in a list, because a hand-maintained list of
 * links is wrong the first time somebody forgets it.
 */
export function releaseTag(version: string): string {
  const bare = version.split("+")[0].trim();
  if (!bare) return "";
  return bare.startsWith("v") ? bare : `v${bare}`;
}

/**
 * One `Label 1.2.3` pair, where only the NUMBER is the link.
 *
 * The label is plain text on purpose: the word is not the thing anybody wants to
 * open, and underlining it makes the eye read "Version" as a destination. No
 * underline on the number either — the affordance is the ink lifting on hover,
 * which is enough for a number nobody is hunting for, and a dotted rule under a
 * version string reads as an annotation with nothing to annotate.
 */
function VersionLink({
  label,
  version,
  repo,
  unreleased,
}: {
  label: string;
  version: string;
  repo: string;
  unreleased: (version: string) => string;
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
  return (
    <span>
      {label}{" "}
      <a
        href={`${repo}/releases/tag/${encodeURIComponent(tag)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono tabular-nums text-carbon-textMuted no-underline hover:text-carbon-text"
      >
        {version}
      </a>
    </span>
  );
}
