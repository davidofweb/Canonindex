import { keccak256, toBytes } from "viem";

export type BasketSeedEntry = {
  readonly symbol: string;
  readonly token: `0x${string}`;
  readonly poolId: `0x${string}`;
  readonly weightBps: number;
  readonly perRunCap: bigint;
};

/**
 * The 10 verified clean Ascend pools on Elysium Testnet (Round 4),
 * totaling 10,000 bps (100.00%) with a 100 USDC per-run cap per coin.
 */
export const ROUND4_CLEAN_BASKET: readonly BasketSeedEntry[] = [
  {
    symbol: "PACT",
    token: "0x4FAA6142168c6A1126df68CF400839126b3664db",
    poolId: "0xfbd4909ed6aa674282af58ecd613836f24aa3da65db9fad4fbe45ecc5b644fe9",
    weightBps: 1694,
    perRunCap: 100_000_000n,
  },
  {
    symbol: "DAWN",
    token: "0xd886e8750c8859bfa15B1f334D6bFD435f2779ab",
    poolId: "0xe12aee0e351751a47de06b5739472047e38cb62a983e97f45ffccd83b582afa8",
    weightBps: 1600,
    perRunCap: 100_000_000n,
  },
  {
    symbol: "AK",
    token: "0x1C7fFc2F75891966bb9016887de3F649bc8c7aE3",
    poolId: "0x26b32a74433f0a1cdeb3130fc2d0fd0309e357131e7b4915c5c7841dbe3f91f4",
    weightBps: 1584,
    perRunCap: 100_000_000n,
  },
  {
    symbol: "REE",
    token: "0x44FEc778Dc5E4872A24996ae6194c3d3C40B79EA",
    poolId: "0xdf6017f36dcb6940f71dd1a321740a73aca70eefabb6566e95ec462c26faa87d",
    weightBps: 1535,
    perRunCap: 100_000_000n,
  },
  {
    symbol: "TROLOLO",
    token: "0x7856a274D83d2F367966b033c757aCf453A19E20",
    poolId: "0x63f22ce7867b22ff5ab3bd989196b34cc6dbfb1c50f132df208a689cf1db3780",
    weightBps: 1452,
    perRunCap: 100_000_000n,
  },
  {
    symbol: "QNCE",
    token: "0x28D59E3FB8170224173B5DFe447Fb4F4C37f5dF5",
    poolId: "0xe2d7355b802a55a94e9dd1fc90bbd9c5959e0023e0e2ba63d647be6d2942b2e0",
    weightBps: 975,
    perRunCap: 100_000_000n,
  },
  {
    symbol: "HAZL",
    token: "0x9de320e11e247d8251b3501B0E8565B6768EB494",
    poolId: "0x8dd9735212dfdb87676d56ca4725f7c78c9352496f4945a405a9b6647c110978",
    weightBps: 953,
    perRunCap: 100_000_000n,
  },
  {
    symbol: "ANGL",
    token: "0x6c5cb15C5BA872676E7ee1Ca00F8dd256F414235",
    poolId: "0x8ecbab36f61898080b85ceb32791052508da56a4128229209506028ab1541b51",
    weightBps: 69,
    perRunCap: 100_000_000n,
  },
  {
    symbol: "PRMR",
    token: "0x7f1088cBC9EB4828298A997470538D0bD2a4EE92",
    poolId: "0x41343a98aea70c4fa747190aed43768af5b13320c740921f38ed9c89f0a775a3",
    weightBps: 69,
    perRunCap: 100_000_000n,
  },
  {
    symbol: "SRRL",
    token: "0xA8f46B3B008d8Ac206B707c6a7643B27d19D21b9",
    poolId: "0x7a8add9b64acc5d4938545a63897ecb73d2a6747b8212db4fff5b199627e008d",
    weightBps: 69,
    perRunCap: 100_000_000n,
  },
] as const;

export const ROUND4_SCORE_ROOT = keccak256(
  toBytes(
    JSON.stringify({
      round: 4,
      rules: "delphi-v0.3",
      tokens: ROUND4_CLEAN_BASKET.map((c) => c.token),
      weightsBps: ROUND4_CLEAN_BASKET.map((c) => c.weightBps),
    }),
  ),
);

export const ROUND4_METHODOLOGY_URI = "https://canon.index/lens/round-4";
