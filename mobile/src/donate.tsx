import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { CRYPTO_COINS, type CryptoCoin, type CryptoNetwork } from "../../web/src/lib/donate";
import { buildQR } from "../../web/src/lib/qr";
import { CoinMark } from "./glyphs";
import { useT } from "./i18n";
import { engine } from "./engine";
import { contrastOn, space, text, TOUCH } from "./theme";
import { Button, useTheme } from "./ui";

/**
 * The crypto window, on the phone.
 *
 * The same window the container opens, built from the same list: `lib/donate.ts`
 * and `lib/qr.ts` are plain data and plain geometry, so both surfaces read them
 * rather than each keeping its own. On a payment address that is not a tidiness
 * argument - a second copy that drifted would be a code scanning to somebody
 * else's wallet, and the person it happens to is a stranger who never writes.
 *
 * THE RULE THE WINDOW EXISTS TO ENFORCE, unchanged from the web: every network a
 * donor can pick carries its OWN address. No line here names a chain without a
 * wallet behind it, so a chain the money cannot arrive on is unofferable rather
 * than merely discouraged. See lib/donate.ts for how nearly shipping the
 * opposite bought that rule.
 *
 * THE ANSWER COMES BEFORE THE QUESTION. The code sits at the top and the picker
 * under it, which is the other way round from a normal dialog: the code is what
 * the window was opened for, and the picker changes it in place, so the thing
 * somebody came to scan never moves off the top of the window.
 */
export function CryptoDonate({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const { p, radius, scheme, accent, hueAt } = useTheme();
  const [coin, setCoin] = useState<CryptoCoin>(CRYPTO_COINS[0]!);
  const [network, setNetwork] = useState<CryptoNetwork>(CRYPTO_COINS[0]!.networks[0]!);
  const [copied, setCopied] = useState(false);

  // The label flips for a moment and goes back, which is how every other copy
  // control in this app answers. No toast system here to push to, and a line of
  // feedback somewhere else on the screen would be worse than the button saying
  // it itself.
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const picked = CRYPTO_COINS.findIndex((c) => c.id === coin.id);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* The ground outside the card dismisses it, like every other dialog in
          this app. Android's own Back does too, through onRequestClose. */}
      <Pressable style={styles.ground} onPress={onClose}>
        {/* The card swallows the press so a tap inside it does not close the
            window it is trying to use. */}
        <Pressable
          onPress={() => {}}
          style={[styles.card, { backgroundColor: p.surface, borderRadius: radius.card }]}
        >
          {/* Rule 15: a window is a window, and its title is a filled badge on
              its top edge - the same object a card's notch is, so a dialog and
              a card are recognisably the same family. No corner X: the footer
              already answers, and one answer offered twice reads as two
              choices. */}
          <View style={styles.titleRow}>
            <View style={[styles.title, { backgroundColor: accent, borderRadius: radius.pill }]}>
              <Text style={[styles.titleText, { color: contrastOn(accent) }]} numberOfLines={2}>
                {t("about.cryptoTitle")}
              </Text>
            </View>
          </View>

          {/* `flexShrink` so the title and the footer keep their room and the
              middle is what gives on a short screen. Without it the card grows
              past its own cap and the close button leaves the screen. */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.intro, { color: p.textSub }]}>{t("about.cryptoIntro")}</Text>

            {/* The answer, first. */}
            <View style={[styles.answer, { backgroundColor: p.surface2, borderRadius: radius.card }]}>
              <QR value={network.address} size={168} />

              {/* Whole, in one piece, in a mono face, and never shortened. An
                  address is read back by eye before somebody sends to it, so an
                  ellipsis in the middle turns the one string that has to be
                  exact into a string nobody can check. */}
              <Text selectable style={[styles.address, { color: p.text }]}>
                {network.address}
              </Text>

              {/* The chain, switched HERE, directly under the address it
                  changes. A picker one box away from its own effect makes
                  somebody look twice to see whether the address moved; a row of
                  chips under it changes the string in front of their eyes.
                  Shown even for a coin with one chain, because this is also the
                  line that SAYS which network the address belongs to, and that
                  fact may not appear and disappear depending on the tile. */}
              <View
                style={styles.chains}
                accessibilityRole="radiogroup"
                accessibilityLabel={t("about.cryptoNetworks")}
              >
                {coin.networks.map((n, i) => {
                  const on = n.id === network.id;
                  const fill = hueAt(i) ?? accent;
                  return (
                    <Pressable
                      key={n.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      onPress={() => {
                        setNetwork(n);
                        setCopied(false);
                      }}
                      style={[
                        styles.chain,
                        {
                          borderRadius: radius.pill,
                          backgroundColor: on ? fill : p.surface3,
                        },
                      ]}
                    >
                      <Text style={[styles.chainText, { color: on ? contrastOn(fill) : p.textSub }]}>
                        {n.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Warn-coloured, and that is not a warning: it is the line a
                  donor would otherwise go hunting for. Exchanges train people
                  to look for a destination tag or a memo, so the chain that
                  does not want one has to say so where the address is. */}
              {network.noteKey ? (
                <Text style={[styles.note, { color: p.warnInk }]}>{t(network.noteKey)}</Text>
              ) : null}

              {/* The one accent surface in this box, so it takes the position
                  of the coin it belongs to: in rainbow mode the copy button is
                  the same colour as the tile the address came from. */}
              <View style={styles.copyRow}>
                <Button
                  label={copied ? t("common.copied") : t("common.copy")}
                  labelKey="common.copy"
                  tone="accent"
                  hue={picked}
                  onPress={() => {
                    try {
                      void engine.copy(network.address).then(() => setCopied(true));
                    } catch {
                      // No native module, which is `expo start` on a laptop and
                      // nowhere else. The address above is selectable, so there
                      // is still a way to take it - and the button saying
                      // "copied" when nothing was copied would be worse.
                    }
                  }}
                />
              </View>
            </View>

            {/* The picker, under the answer it changes. Tiles rather than a
                list, because a coin is recognised by its mark faster than its
                name is read, and a grid of marks is the one layout that says at
                a glance what is on offer. Four across, as on the web, so the
                eight land in two even rows.

                The marks are shown in EVERY label mode, which is the one place
                this app departs from the engine: a coin's mark is what the grid
                is scanned by, and hiding it until a word is asked for would
                turn "find USDT" into reading eight tickers in turn. */}
            <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={t("about.cryptoTitle")}>
              {CRYPTO_COINS.map((c, i) => {
                const on = c.id === coin.id;
                const fill = hueAt(i) ?? accent;
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${c.name} (${c.symbol})`}
                    onPress={() => {
                      setCoin(c);
                      // Picking a coin must land on a network of THAT coin.
                      // Keeping the previous chain when it happens to also
                      // carry the new coin is a convenience with one bad case:
                      // a chain somebody last looked at staying selected under
                      // a coin they never checked it against.
                      setNetwork(c.networks[0]!);
                      setCopied(false);
                    }}
                    style={[
                      styles.tile,
                      {
                        borderRadius: radius.control,
                        backgroundColor: on ? fill : p.surface2,
                      },
                    ]}
                  >
                    <CoinMark coin={c.id} size={22} scheme={scheme} />
                    <Text style={[styles.ticker, { color: on ? contrastOn(fill) : p.textSub }]}>
                      {c.symbol}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button label={t("common.close")} labelKey="common.close" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * The address as a scannable square.
 *
 * Black on white and NOT theme-following, which is deliberate and the same
 * decision the browser makes: a camera wants contrast in the direction it
 * expects, and a code drawn light-on-dark is inverted. Some scanners cope,
 * plenty do not, and a wallet that will not read the code is the last minute of
 * somebody trying to give money away.
 */
function QR({ value, size }: { value: string; size: number }) {
  const { path, extent } = useMemo(() => buildQR(value), [value]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${extent} ${extent}`}>
      <Rect width={extent} height={extent} fill="#ffffff" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.lg,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  // A cap rather than a height: the window is as tall as it needs to be, and
  // only starts scrolling on a handset that cannot hold it.
  card: { width: "100%", maxWidth: 420, maxHeight: "88%", overflow: "hidden" },
  titleRow: { paddingHorizontal: space.lg, paddingTop: space.lg },
  title: { alignSelf: "flex-start", paddingHorizontal: space.md, paddingVertical: 3 },
  titleText: { fontSize: text.caption, fontWeight: "500", textTransform: "uppercase", letterSpacing: 1.2 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { padding: space.lg, gap: space.md },
  intro: { fontSize: text.body, lineHeight: text.body + 6 },

  answer: { padding: space.lg, gap: space.md, alignItems: "center" },
  address: {
    fontFamily: "monospace",
    fontSize: text.dense,
    textAlign: "center",
    // Wrapped rather than truncated, for the reason above the element.
    width: "100%",
  },
  chains: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space.sm },
  chain: { paddingHorizontal: space.md, paddingVertical: 6 },
  chainText: { fontSize: text.dense, fontWeight: "500" },
  note: { fontSize: text.dense, textAlign: "center" },
  copyRow: { flexDirection: "row", alignSelf: "stretch" },

  // Four across on any width, which is what the eight coins need to land in two
  // even rows. A fifth cannot fit - five bases of 20% plus four gaps is over the
  // line - and `flexGrow` then spreads the four across whatever is left, so the
  // row fills exactly rather than leaving a ragged margin on a narrow handset.
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: {
    flexBasis: "20%",
    flexGrow: 1,
    minHeight: TOUCH + 8,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    paddingVertical: space.md,
  },
  ticker: { fontSize: text.caption, fontWeight: "500" },

  footer: { flexDirection: "row", justifyContent: "flex-end", padding: space.lg, paddingTop: 0 },
});
