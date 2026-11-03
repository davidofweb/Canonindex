import { useSyncExternalStore } from "react";
import { defineChain, isAddress } from "viem";
import { createConfig, http } from "wagmi";
import { injected, mock, walletConnect } from "wagmi/connectors";
import { DEPLOYMENTS, SHARED_TESTNET_DEPLOYMENT, type Deployment } from "./deployments";

const rpcUrl = import.meta.env.VITE_RPC_URL || "https://testnet-rpc.elysium.kinetiq.xyz";

/** Elysium testnet: Hyperliquid's first L2, where Ascend runs. */
export const elysium = defineChain({
  id: 99801,
  name: "Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "Elysium explorer", url: "https://elysium.kinetiq.xyz/testnet-explorer" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export const ASCEND_TESTNET_LAUNCHPAD = "0xE2f6254508DEB93Da081837F545e0bAF7b00d8E9" as const;
export const ASCEND_TESTNET_USDC = "0x4b4fb5C5794F0c821464956374cC5872D5F0f140" as const;
export const ELYSIUM_BURN_SINK = "0xC889ac2f59A88afb3B2FB3f2C452DBa336fE5f0F" as const;

const ACTIVE_STORAGE_KEY = "canon.activeDeployment.v1";
const deploymentName = import.meta.env.VITE_DEPLOYMENT || "elysium-testnet";
const fallbackDeployment: Deployment | null = DEPLOYMENTS[deploymentName] ?? null;

function isValidDeployment(raw: unknown): raw is Deployment {
  if (!raw || typeof raw !== "object") return false;
  const d = raw as Record<string, unknown>;
  if (d.chainId !== 99801) return false;
  const requiredAddresses = [
    "launchpad",
    "usdc",
    "burnSink",
    "passportRegistry",
    "covenantFactory",
    "pnth",
    "pnthRouter",
    "constituentRegistry",
    "staking",
    "indexVault",
  ];
  for (const key of requiredAddresses) {
    if (typeof d[key] !== "string" || !isAddress(d[key] as string, { strict: false })) {
      return false;
    }
  }
  return typeof d.pnthPool === "string" && /^0x[0-9a-fA-F]{64}$/.test(d.pnthPool);
}

function readUrlDeployment(): Deployment | null {
  if (typeof window === "undefined") return null;
  try {
    const rawParam = new URLSearchParams(window.location.search).get("canon");
    if (!rawParam) return null;
    return decodeShareableDeployment(rawParam);
  } catch {
    return null;
  }
}

type CompactShareTuple = {
  l: string; // launchpad
  pr: string; // passportRegistry
  cf: string; // covenantFactory
  t: string; // pnth ($CANON token)
  pl: string; // pnthPool
  r: string; // pnthRouter
  cr: string; // constituentRegistry
  s: string; // staking
  v: string; // indexVault
  sw?: string; // swapper
  d?: string; // drip
  tm?: string; // team
  tb?: number; // teamBps
  nm?: string; // tokenName
  sy?: string; // tokenSymbol
  b?: string; // deployedBlock
};

export function encodeShareableDeployment(dep: Deployment): string {
  const payload: CompactShareTuple = {
    l: dep.launchpad,
    pr: dep.passportRegistry,
    cf: dep.covenantFactory,
    t: dep.pnth,
    pl: dep.pnthPool,
    r: dep.pnthRouter,
    cr: dep.constituentRegistry,
    s: dep.staking,
    v: dep.indexVault,
    ...(dep.swapper ? { sw: dep.swapper } : {}),
    ...(dep.drip ? { d: dep.drip } : {}),
    ...(dep.team ? { tm: dep.team } : {}),
    ...(typeof dep.teamBps === "number" ? { tb: dep.teamBps } : {}),
    ...(dep.tokenName ? { nm: dep.tokenName } : {}),
    ...(dep.tokenSymbol ? { sy: dep.tokenSymbol } : {}),
    ...(dep.deployedBlock ? { b: dep.deployedBlock } : {}),
  };
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeShareableDeployment(encoded: string): Deployment | null {
  try {
    const clean = encoded.trim().replace(/-/g, "+").replace(/_/g, "/");
    if (!clean) return null;
    const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CompactShareTuple>;
    const candidate: Record<string, unknown> = {
      chainId: 99801,
      launchpad: parsed.l,
      ascendLaunchpad: ASCEND_TESTNET_LAUNCHPAD,
      usdc: ASCEND_TESTNET_USDC,
      burnSink: ELYSIUM_BURN_SINK,
      passportRegistry: parsed.pr,
      covenantFactory: parsed.cf,
      pnth: parsed.t,
      pnthPool: parsed.pl,
      pnthRouter: parsed.r,
      constituentRegistry: parsed.cr,
      staking: parsed.s,
      indexVault: parsed.v,
      ...(parsed.sw && isAddress(parsed.sw, { strict: false }) ? { swapper: parsed.sw } : {}),
      ...(parsed.d && isAddress(parsed.d, { strict: false }) ? { drip: parsed.d } : {}),
      ...(parsed.tm && isAddress(parsed.tm, { strict: false }) ? { team: parsed.tm } : {}),
      ...(typeof parsed.tb === "number" && parsed.tb >= 0 && parsed.tb <= 5000
        ? { teamBps: parsed.tb }
        : {}),
      ...(typeof parsed.nm === "string" && parsed.nm.trim()
        ? { tokenName: parsed.nm.trim().slice(0, 32) }
        : {}),
      ...(typeof parsed.sy === "string" && parsed.sy.trim()
        ? { tokenSymbol: parsed.sy.trim().toUpperCase().slice(0, 12) }
        : {}),
      ...(typeof parsed.b === "string" && /^\d+$/.test(parsed.b) ? { deployedBlock: parsed.b } : {}),
      customActive: true,
    };
    return isValidDeployment(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function buildBackerShareUrl(dep: Deployment, targetPath = "/trade"): string {
  const origin =
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "https://canon.elysium.testnet";
  const url = new URL(targetPath, origin);
  url.searchParams.set("canon", encodeShareableDeployment(dep));
  return url.toString();
}

function readStoredDeployment(): Deployment | null {
  if (typeof window === "undefined") return fallbackDeployment;
  const fromUrl = readUrlDeployment();
  if (fromUrl) {
    try {
      window.localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify({ ...fromUrl, customActive: true }));
    } catch {
      // Storage unavailable
    }
    return fromUrl;
  }
  try {
    const raw = window.localStorage.getItem(ACTIVE_STORAGE_KEY);
    if (!raw) return fallbackDeployment;
    const parsed = JSON.parse(raw) as unknown;
    if (isValidDeployment(parsed)) {
      return { ...parsed, customActive: true };
    }
  } catch {
    // Ignore malformed storage
  }
  return fallbackDeployment;
}

export let deployment: Deployment | null = readStoredDeployment();
export let deployedFrom: bigint =
  deployment?.deployedBlock && /^\d+$/.test(deployment.deployedBlock)
    ? BigInt(deployment.deployedBlock)
    : deploymentName === "elysium-testnet"
      ? 9_127_000n
      : 9_100_000n;

let version = 0;
const listeners = new Set<() => void>();

function notifyListeners() {
  version += 1;
  for (const fn of listeners) fn();
}

function syncUrlCanonParam(next: Deployment | null) {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (next && next.pnth.toLowerCase() !== SHARED_TESTNET_DEPLOYMENT.pnth.toLowerCase()) {
      url.searchParams.set("canon", encodeShareableDeployment(next));
    } else {
      url.searchParams.delete("canon");
    }
    const qs = url.searchParams.toString();
    window.history.replaceState(null, "", `${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`);
  } catch {
    // Ignore history error
  }
}

export function setClientDeployment(next: Deployment | null, persistLocal = true) {
  deployment = next ?? fallbackDeployment;
  deployedFrom =
    deployment?.deployedBlock && /^\d+$/.test(deployment.deployedBlock)
      ? BigInt(deployment.deployedBlock)
      : 9_127_000n;

  if (persistLocal && typeof window !== "undefined") {
    try {
      if (next && next.pnth.toLowerCase() !== SHARED_TESTNET_DEPLOYMENT.pnth.toLowerCase()) {
        window.localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify({ ...next, customActive: true }));
      } else {
        window.localStorage.removeItem(ACTIVE_STORAGE_KEY);
      }
    } catch {
      // Storage unavailable
    }
  }
  notifyListeners();
}

export async function syncDeploymentFromServer(): Promise<Deployment | null> {
  // If backer or grant reviewer opened a portable ?canon=... link, honor it and sync server to match
  const fromUrl = readUrlDeployment();
  if (fromUrl) {
    setClientDeployment(fromUrl, true);
    await fetch("/api/deployment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fromUrl),
    }).catch(() => null);
    return deployment;
  }

  try {
    const res = await fetch("/api/deployment");
    if (!res.ok) return deployment;
    const data = (await res.json()) as { customActive?: boolean; deployment?: unknown };
    if (data.customActive && isValidDeployment(data.deployment)) {
      setClientDeployment({ ...data.deployment, customActive: true }, true);
    }
  } catch {
    // Keep current client deployment
  }
  return deployment;
}

export async function activateCustomDeployment(next: Deployment): Promise<void> {
  const clean: Deployment = {
    ...next,
    customActive: true,
    activatedAt: next.activatedAt ?? new Date().toISOString(),
  };
  setClientDeployment(clean, true);
  syncUrlCanonParam(clean);
  await fetch("/api/deployment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(clean),
  }).catch(() => null);
}

export async function resetToSharedDeployment(): Promise<void> {
  setClientDeployment(SHARED_TESTNET_DEPLOYMENT, true);
  syncUrlCanonParam(null);
  await fetch("/api/deployment", { method: "DELETE" }).catch(() => null);
}

/**
 * Switches connected wallet to Elysium Testnet (99801), automatically adding
 * Chain 99801 via EIP-3085 if a mobile or browser wallet doesn't know it yet.
 */
export async function ensureElysiumNetwork(
  switchFn: (args: { chainId: number }) => Promise<unknown>,
): Promise<void> {
  try {
    await switchFn({ chainId: elysium.id });
  } catch (err) {
    const eth = (
      typeof window !== "undefined"
        ? (window as unknown as {
            ethereum?: { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
          }).ethereum
        : undefined
    );
    if (eth?.request) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${elysium.id.toString(16)}`,
            chainName: elysium.name,
            nativeCurrency: elysium.nativeCurrency,
            rpcUrls: [rpcUrl],
            blockExplorerUrls: [elysium.blockExplorers.default.url],
          },
        ],
      });
      await switchFn({ chainId: elysium.id });
      return;
    }
    throw err;
  }
}

export function useDeploymentVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => 0,
  );
}

export function isCustomCanonActive(): boolean {
  return (
    !!deployment &&
    deployment.pnth.toLowerCase() !== SHARED_TESTNET_DEPLOYMENT.pnth.toLowerCase()
  );
}

export const explorer = (kind: "tx" | "address" | "token", value: string) =>
  `${elysium.blockExplorers.default.url}/${kind}/${value}`;

const REOWN_PROJECT_ID = "82e0568de03aa0db655af8f406936dcc";
const devWallet = (import.meta.env.VITE_DEV_WALLET || undefined) as `0x${string}` | undefined;
export const wcProjectId = (import.meta.env.VITE_WC_PROJECT_ID || REOWN_PROJECT_ID).trim();

const baseConnectors = [
  ...(devWallet ? [mock({ accounts: [devWallet], features: { reconnect: true } })] : []),
  injected(),
  ...(wcProjectId && typeof window !== "undefined"
    ? [
        walletConnect({
          projectId: wcProjectId,
          showQrModal: false,
          metadata: {
            name: "CANON",
            description: "Ascend top 10 clean coins in one token.",
            url: window.location.origin,
            icons: [`${window.location.origin}/favicon.svg`],
          },
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [elysium],
  connectors: baseConnectors,
  transports: { [elysium.id]: http() },
  ssr: false,
});
