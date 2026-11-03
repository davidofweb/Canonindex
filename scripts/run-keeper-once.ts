import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  constituentRegistryAbi,
  covenantRouterAbi,
  indexVaultAbi,
  pantheonStakingAbi,
} from "../src/lib/chain/abi.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const RPC_URL =
  process.env.RPC_URL ||
  process.env.VITE_RPC_URL ||
  "https://testnet-rpc.elysium.kinetiq.xyz";

const elysium = defineChain({
  id: 99801,
  name: "Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

type KeeperDeployment = {
  chainId: number;
  usdc: Address;
  pnth: Address;
  pnthRouter: Address;
  constituentRegistry: Address;
  staking: Address;
  indexVault: Address;
  deployedBlock?: string;
};

const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

const STAKED_EVENT = parseAbiItem(
  "event Staked(address indexed account, uint256 amount)",
);

async function loadDeployment(): Promise<{ source: string; deployment: KeeperDeployment }> {
  const inlineJson = process.env.CANON_DEPLOYMENT_JSON?.trim();
  if (inlineJson) {
    return {
      source: "CANON_DEPLOYMENT_JSON",
      deployment: JSON.parse(inlineJson) as KeeperDeployment,
    };
  }

  const customPath = path.join(ROOT, "src/data/deployments/active-deployment.json");
  try {
    const raw = await fs.readFile(customPath, "utf8");
    return {
      source: "src/data/deployments/active-deployment.json",
      deployment: JSON.parse(raw) as KeeperDeployment,
    };
  } catch {
    // Fall back to shared testnet config
  }

  const sharedPath = path.join(ROOT, "src/data/deployments/elysium-testnet.json");
  const raw = await fs.readFile(sharedPath, "utf8");
  return {
    source: "src/data/deployments/elysium-testnet.json",
    deployment: JSON.parse(raw) as KeeperDeployment,
  };
}

async function discoverStakers(
  publicClient: ReturnType<typeof createPublicClient>,
  staking: Address,
  fromHint?: string,
): Promise<Address[]> {
  const head = await publicClient.getBlockNumber();
  const hint = fromHint && /^\d+$/.test(fromHint) ? BigInt(fromHint) : 0n;
  const lookbackStart = head > 45_000n ? head - 45_000n : 0n;
  const start = hint > lookbackStart ? hint : lookbackStart;

  const unique = new Set<string>();
  const step = 9_000n;
  for (let cur = start; cur <= head; cur += step + 1n) {
    const toBlock = cur + step > head ? head : cur + step;
    try {
      const logs = await publicClient.getLogs({
        address: staking,
        event: STAKED_EVENT,
        fromBlock: cur,
        toBlock,
      });
      for (const log of logs) {
        if (log.args.account) {
          unique.add(getAddress(log.args.account));
        }
      }
    } catch {
      // Continue across next log window if an archive range times out
    }
  }

  const passportApi = process.env.PASSPORT_API?.trim();
  if (passportApi) {
    try {
      const res = await fetch(`${passportApi.replace(/\/$/, "")}/passport/pokes`, {
        signal: AbortSignal.timeout(4_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { accounts?: string[] };
        for (const acct of data.accounts ?? []) {
          try {
            unique.add(getAddress(acct));
          } catch {
            // Skip invalid entry
          }
        }
      }
    } catch {
      // Optional upstream feed
    }
  }

  return [...unique] as Address[];
}

async function main() {
  const { source, deployment } = await loadDeployment();
  const publicClient = createPublicClient({
    chain: elysium,
    transport: http(RPC_URL, { timeout: 12_000 }),
  });

  const keeperKey = process.env.KEEPER_KEY?.trim() as Hex | undefined;
  const account =
    keeperKey && /^0x[0-9a-fA-F]{64}$/.test(keeperKey)
      ? privateKeyToAccount(keeperKey)
      : null;

  const walletClient = account
    ? createWalletClient({
        account,
        chain: elysium,
        transport: http(RPC_URL, { timeout: 15_000 }),
      })
    : null;

  const blockNumber = await publicClient.getBlockNumber();
  console.log(`CANON Keeper · Elysium Testnet (block ${blockNumber})`);
  console.log(`Config source: ${source}`);
  console.log(`Mode: ${account ? `Live signer (${account.address})` : "Dry-run check (no KEEPER_KEY set)"}`);

  // 1. Check Fee Lock Router
  let shouldRunRouter = false;
  try {
    const sim = await publicClient.simulateContract({
      address: deployment.pnthRouter,
      abi: covenantRouterAbi,
      functionName: "run",
      account: account?.address ?? "0x000000000000000000000000000000000000dEaD",
    });
    const [newToken, newQuote] = sim.result;
    const [pendingTok, pendingQuo] = await Promise.all([
      publicClient.readContract({
        address: deployment.pnthRouter,
        abi: covenantRouterAbi,
        functionName: "pendingOf",
        args: [0],
      }),
      publicClient.readContract({
        address: deployment.pnthRouter,
        abi: covenantRouterAbi,
        functionName: "pendingOf",
        args: [1],
      }),
    ]);
    const hasDeferred = [...pendingTok, ...pendingQuo].some((v) => v > 0n);
    shouldRunRouter = newToken > 0n || newQuote > 0n || hasDeferred;
    console.log(
      `[1/3] Fee Lock Router (${deployment.pnthRouter}): newToken=${formatUnits(newToken, 18)} CANON, newQuote=${formatUnits(newQuote, 6)} USDC -> ${shouldRunRouter ? "READY" : "idle"}`,
    );

    if (shouldRunRouter && walletClient && account) {
      const hash = await walletClient.writeContract({
        address: deployment.pnthRouter,
        abi: covenantRouterAbi,
        functionName: "run",
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`      ✓ Routed fees in tx ${hash}`);
    }
  } catch (e) {
    console.log(`[1/3] Fee Lock Router check skipped: ${(e as Error).message.split("\n")[0]}`);
  }

  // 2. Check IndexVault Rebalance
  try {
    const [vaultUsdc, activeBasket] = await Promise.all([
      publicClient.readContract({
        address: deployment.usdc,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [deployment.indexVault],
      }),
      publicClient.readContract({
        address: deployment.constituentRegistry,
        abi: constituentRegistryAbi,
        functionName: "active",
      }),
    ]);

    const readyRebalance = vaultUsdc >= 100_000n && activeBasket.length > 0; // >= 0.10 USDC and active basket
    console.log(
      `[2/3] IndexVault (${deployment.indexVault}): budget=${formatUnits(vaultUsdc, 6)} USDC, activeCoins=${activeBasket.length} -> ${readyRebalance ? "READY" : "idle"}`,
    );

    if (readyRebalance && walletClient && account) {
      const hash = await walletClient.writeContract({
        address: deployment.indexVault,
        abi: indexVaultAbi,
        functionName: "rebalance",
        args: [5n],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`      ✓ Rebalanced 5 basket slots in tx ${hash}`);
    }
  } catch (e) {
    console.log(`[2/3] IndexVault check skipped: ${(e as Error).message.split("\n")[0]}`);
  }

  // 3. Check Staking Boost Pokes
  try {
    const stakers = await discoverStakers(publicClient, deployment.staking, deployment.deployedBlock);
    const drifted: Address[] = [];

    for (const addr of stakers.slice(0, 60)) {
      const [acct, freshWorking] = await Promise.all([
        publicClient.readContract({
          address: deployment.staking,
          abi: pantheonStakingAbi,
          functionName: "accounts",
          args: [addr],
        }),
        publicClient.readContract({
          address: deployment.staking,
          abi: pantheonStakingAbi,
          functionName: "workingOf",
          args: [addr],
        }),
      ]);
      if (acct[0] > 0n && acct[2] !== freshWorking) {
        drifted.push(addr);
      }
      if (drifted.length >= 20) break;
    }

    console.log(
      `[3/3] Staking Boosts (${deployment.staking}): scanned=${stakers.length}, drifted=${drifted.length} -> ${drifted.length > 0 ? "READY" : "up to date"}`,
    );

    if (drifted.length > 0 && walletClient && account) {
      const hash = await walletClient.writeContract({
        address: deployment.staking,
        abi: pantheonStakingAbi,
        functionName: "poke",
        args: [drifted],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`      ✓ Poked ${drifted.length} staker weights in tx ${hash}`);
    }
  } catch (e) {
    console.log(`[3/3] Staking poke check skipped: ${(e as Error).message.split("\n")[0]}`);
  }
}

main().catch((err) => {
  console.error("Keeper run failed:", err);
  process.exit(1);
});
