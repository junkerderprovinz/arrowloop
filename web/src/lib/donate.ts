// The donation addresses and the other links the About cards carry, kept in
// one place for the container and the phone.
//
// Every network a donor can pick carries its own address, so no chain can be
// offered without a wallet that lives on it. A single 0x address listed under
// Tron or Solana would send the money nowhere. donate.test.ts checks each
// address as far as its format allows.

/**
 * The two routes the phone opens as a plain link, beside the coins below. The
 * PayPal page also stands in for the PayPal window wherever popups do not work.
 */
export const COFFEE = "https://buymeacoffee.com/junkerderprovinz";
export const PAYPAL = "https://www.paypal.com/donate/?hosted_button_id=76FVV52TKXTUS";

/** The one BMAC page that allows framing, for the coffee window in the browser. */
export const COFFEE_WIDGET =
  "https://buymeacoffee.com/widget/page/junkerderprovinz?description=&color=%23FFDD00";

/**
 * The live PayPal app behind the browser's PayPal window. Each plan costs 1 EUR
 * a unit, and a recurring donation subscribes to it with the amount as the
 * quantity.
 */
export const PAYPAL_GIVING = {
  clientId: "BAAbFqgNYfuCIBT_gwVE64oqj-E-jmxFiLaoR1yMIF9KK-CW16x5Pt2bSjBloqbTF4TvjFYw3ZTLnRP8_U",
  plans: { month: "P-2ND5083133959702RNK2375A", year: "P-2FN843952N550243RNK2375A" },
  currency: "EUR",
};

export const REPO = "https://github.com/junkerderprovinz/arrowloop";
export const GLIMSTONE_REPO = "https://github.com/junkerderprovinz/glimstone";
/** Shared by every tool; the subject line names the product. */
export const MAIL = "hello@halleluja.design";

/** Where a version number links to, built from the version rather than listed per release. */
export const glimstoneRelease = (version: string): string =>
  `${GLIMSTONE_REPO}/releases/tag/v${version}`;

/** One address, and the chain it lives on. */
export interface CryptoNetwork {
  /** Stable id, for the copy toast and for tests. */
  id: string;
  /** The chain as a donor's wallet names it. */
  name: string;
  address: string;
  /** A short line shown with the address, for what a donor has to know. */
  noteKey?: "about.cryptoNoTag";
}

/** One coin, and every chain it can be sent on here. */
export interface CryptoCoin {
  /** Stable id, and the key components/donateMarks.tsx draws the mark by. */
  id: string;
  /** The ticker, on the tile under the mark. */
  symbol: string;
  /** The full name, for the accessible label. */
  name: string;
  /** Never empty, and every entry carries an address. */
  networks: CryptoNetwork[];
  /** The coin's own colour and the ink that holds on it, white wherever white
   *  reaches 2:1, which its tile lights up in under the pointer. */
  tile: { color: string; ink: string };
}

const BTC = "bc1q078lt57t4n5zq5md3knz3ythum0w78zmjw5eda";
/** One address for every EVM chain: the same key controls it on all of them. */
const EVM = "0xFF6726C5bd76C8FD6b6bE7Ea5CEd4621fde5e841";
const SOL = "GrTyhSbZVArdaZAr3TqWDrkEGahomLtNZJ41qPLm3dHd";
const SUI = "0xa76677f71d107c9a957c2d1814b68027cbd4ad9dbf28d911a97fad5d2fc3a414";
const XRP = "rwMK2nXqChT4JYWVypMypnpctDcM9jgWmG";

const ETHEREUM = { id: "ethereum", name: "Ethereum", address: EVM };
const BASE = { id: "base", name: "Base", address: EVM };
const OPTIMISM = { id: "optimism", name: "Optimism", address: EVM };
const BSC = { id: "bsc", name: "BNB Smart Chain", address: EVM };
const SOLANA = { id: "solana", name: "Solana", address: SOL };

export const CRYPTO_COINS: CryptoCoin[] = [
  {
    id: "btc",
    symbol: "BTC",
    name: "Bitcoin",
    tile: { color: "#f7931a", ink: "#ffffff" },
    networks: [{ id: "bitcoin", name: "Bitcoin", address: BTC }],
  },
  {
    id: "eth",
    symbol: "ETH",
    name: "Ethereum",
    tile: { color: "#627eea", ink: "#ffffff" },
    // Native ETH only. ETH on BNB Smart Chain is a bridged token.
    networks: [ETHEREUM, BASE, OPTIMISM],
  },
  {
    id: "usdt",
    symbol: "USDT",
    name: "Tether",
    tile: { color: "#26a17b", ink: "#ffffff" },
    networks: [ETHEREUM, BSC, SOLANA],
  },
  {
    id: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    tile: { color: "#2775ca", ink: "#ffffff" },
    networks: [ETHEREUM, BASE, SOLANA],
  },
  {
    id: "bnb",
    symbol: "BNB",
    name: "BNB",
    tile: { color: "#f3ba2f", ink: "#161616" },
    networks: [BSC],
  },
  {
    id: "sol",
    symbol: "SOL",
    name: "Solana",
    tile: { color: "#9945ff", ink: "#ffffff" },
    networks: [SOLANA],
  },
  {
    id: "sui",
    symbol: "SUI",
    name: "Sui",
    tile: { color: "#4da2ff", ink: "#ffffff" },
    networks: [{ id: "sui", name: "Sui", address: SUI }],
  },
  {
    id: "xrp",
    symbol: "XRP",
    name: "XRP",
    tile: { color: "#23292f", ink: "#ffffff" },
    networks: [
      {
        id: "xrpl",
        name: "XRP Ledger",
        address: XRP,
        // Exchanges often demand a destination tag. This self-custody account
        // has RequireDest off, so the note says none is needed.
        noteKey: "about.cryptoNoTag",
      },
    ],
  },
];

/**
 * Which wallet each chain must resolve to. Written out by hand rather than
 * derived from the list, so the test cannot agree with a mistake in it.
 */
export const ADDRESS_BY_CHAIN: Record<string, string> = {
  bitcoin: BTC,
  ethereum: EVM,
  base: EVM,
  optimism: EVM,
  bsc: EVM,
  solana: SOL,
  sui: SUI,
  xrpl: XRP,
};
