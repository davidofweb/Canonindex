import testnet from "./elysium-testnet.json";
import local from "./local.json";

/** Contract addresses per network for CANON ($CANON token, Vault, Staking, Pass, and helpers). */
export type Deployment = {
  chainId: number;
  launchpad: `0x${string}`;
  /** Official Ascend Launchpad used by ConstituentRegistry and IndexVault for basket coin pools. */
  ascendLaunchpad?: `0x${string}`;
  usdc: `0x${string}`;
  burnSink: `0x${string}`;
  passportRegistry: `0x${string}`;
  covenantFactory: `0x${string}`;
  pnth: `0x${string}`;
  pnthPool: `0x${string}`;
  pnthRouter: `0x${string}`;
  constituentRegistry: `0x${string}`;
  staking: `0x${string}`;
  indexVault: `0x${string}`;
  /** Verified exact-input swap helper for buying and selling $CANON on Elysium Testnet. */
  swapper?: `0x${string}`;
  /** Testnet only: one-time free $CANON claim contract per wallet. */
  drip?: `0x${string}`;
  /** Optional creator fee recipient and basis points (e.g. 1500 = 15%). */
  team?: `0x${string}`;
  teamBps?: number;
  /** Optional metadata for custom $CANON launches activated from Testnet Studio. */
  tokenName?: string;
  tokenSymbol?: string;
  customActive?: boolean;
  deployedBlock?: string;
  activatedAt?: string;
};

export const SHARED_TESTNET_DEPLOYMENT = testnet as Deployment;

export const DEPLOYMENTS: Record<string, Deployment | undefined> = {
  "elysium-testnet": SHARED_TESTNET_DEPLOYMENT,
  local: local as Deployment,
};
