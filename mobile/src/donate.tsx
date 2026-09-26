import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { CRYPTO_COINS, type CryptoCoin, type CryptoNetwork } from "../../web/src/lib/donate";
import { buildQR } from "../../web/src/lib/qr";
import { CoinMark } from "./glyphs";
import { useT } from "./i18n";
import { engine } from "./engine";
import { animateNext, useMotion } from "./motion";
import { contrastOn, SCRIM, space, text, TOUCH } from "./theme";
import { Button, useTheme } from "./ui";

/**
 * The crypto donation dialog, built from the web app's lib/donate.ts and
 * lib/qr.ts so the addresses cannot drift apart. Every network offered carries
 * its own address. The code sits above the picker, so what somebody came to
 * scan stays in place while the picker changes it.
 */
export function CryptoDonate({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const { p, corners, scheme, accent, hueAt } = useTheme();
  const { intensity: motion } = useMotion();
  const [coin, setCoin] = useState<CryptoCoin>(CRYPTO_COINS[0]!);
  const [network, setNetwork] = useState<CryptoNetwork>(CRYPTO_COINS[0]!.networks[0]!);
  const [copied, setCopied] = useState(false);
  // Counts the copies, so a second one swells the button again.
  const [copies, setCopies] = useState(0);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const picked = CRYPTO_COINS.findIndex((c) => c.id === coin.id);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.ground} onPress={onClose}>
        {/* Swallows presses so a tap inside does not close the dialog. */}
        <Pressable
          onPress={() => {}}
          style={[styles.card, { backgroundColor: p.surface, ...corners.card }]}
        >
          {/* The title is a filled badge on the top edge, like a card's notch.
              No corner X, since the footer already closes. */}
          <View style={styles.titleRow}>
            <View style={[styles.title, { backgroundColor: accent, ...corners.pill }]}>
              <Text style={[styles.titleText, { color: contrastOn(accent) }]} numberOfLines={2}>
                {t("about.cryptoTitle")}
              </Text>
            </View>
          </View>

          {/* The middle shrinks on a short screen, so the footer stays visible. */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.intro, { color: p.text }]}>{t("about.donateAppeal")}</Text>
            <Text style={[styles.intro, { color: p.textSub }]}>{t("about.cryptoIntro")}</Text>

            <View style={[styles.answer, { backgroundColor: p.surface2, ...corners.control }]}>
              <QR value={network.address} size={168} />

              {/* Never shortened: an address is checked by eye before sending. */}
              <Text selectable style={[styles.address, { color: p.text }]}>
                {network.address}
              </Text>

              {/* Shown even for a coin with one chain, since it also names the
                  network the address belongs to. */}
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
                        // The address and note change length, so the box resizes.
                        animateNext(motion);
                        setNetwork(n);
                        setCopied(false);
                      }}
                      style={[
                        styles.chain,
                        {
                          ...corners.pill,
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

              {/* Says, for example, that a chain needs no memo, which donors who
                  know exchanges would otherwise look for. */}
              {network.noteKey ? (
                <Text style={[styles.note, { color: p.warnInk }]}>{t(network.noteKey)}</Text>
              ) : null}

              {/* Takes the coin's position, so in rainbow mode the button
                  matches the picked tile. */}
              <View style={styles.copyRow}>
                <Button
                  label={copied ? t("common.copied") : t("common.copy")}
                  labelKey="common.copy"
                  tone="accent"
                  hue={picked}
                  confirm={copies}
                  onPress={() => {
                    try {
                      void engine.copy(network.address).then(() => {
                        setCopied(true);
                        setCopies((n) => n + 1);
                      });
                    } catch {
                      // No native module under `expo start`; the address stays
                      // selectable.
                    }
                  }}
                />
              </View>
            </View>

            {/* The coin marks show in every label mode, since the grid is
                scanned by mark. */}
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
                      animateNext(motion);
                      setCoin(c);
                      // Always the new coin's first network, never a chain
                      // carried over from the previous coin.
                      setNetwork(c.networks[0]!);
                      setCopied(false);
                    }}
                    style={[
                      styles.tile,
                      {
                        ...corners.control,
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
 * The address as a QR code, black on white in every theme: many scanners
 * cannot read an inverted code.
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
    backgroundColor: SCRIM,
  },
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
    width: "100%",
  },
  chains: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space.sm },
  chain: { paddingHorizontal: space.md, paddingVertical: 6 },
  chainText: { fontSize: text.dense, fontWeight: "500" },
  note: { fontSize: text.dense, textAlign: "center" },
  copyRow: { flexDirection: "row", alignSelf: "stretch" },

  // Four across at any width: five 20% bases plus the gaps overflow, and
  // flexGrow spreads the four over the row.
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
