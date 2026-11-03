import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  KEEPER_KV: KvNamespaceLike;
  CHAIN_ID?: string;
  ELYSIUM_RPC?: string;
  PASSPORT_WORKER_URL?: string;
  CANON_DEPLOYMENT_JSON: string;
  BASKET_K?: string;
  POKE_BATCH?: string;
  POKE_RISE_BPS?: string;
  KEEPER_KEY?: string;
  TRIGGER_TOKEN?: string;
}

type DeploymentAddresses = {
  pnthRouter: Address;
  indexVault: Address;
  staking: Address;
  deployedBlock?: string;
};

type KeeperCursorState = {
  stakedCursor: string;
  pokesSince: number;
  sweep: number;
  stakers: Address[];
  lastRunAt?: string;
  lastSentCount?: number;
};

const routerAbi = [
  {
    type: "function",
    name: "run",
    inputs: [],
    outputs: [
      { name: "newToken", type: "uint256" },
      { name: "newQuote", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "LegExecuted",
    inputs: [
      { name: "runId", type: "uint256", indexed: true },
      { name: "side", type: "uint8", indexed: true },
      { name: "leg", type: "uint256", indexed: true },
      { name: "job", type: "uint8", indexed: false },
      { name: "to", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

const vaultAbi = [
  {
    type: "function",
    name: "rebalance",
    inputs: [{ name: "k", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "BasketBuy",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "quoteIn", type: "uint256", indexed: false },
      { name: "tokensOut", type: "uint256", indexed: false },
      { name: "emaSqrt", type: "uint160", indexed: false },
      { name: "spotSqrt", type: "uint160", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Streamed",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

const stakingAbi = [
  {
    type: "function",
    name: "accounts",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "staked", type: "uint256" },
      { name: "cooling", type: "uint256" },
      { name: "working", type: "uint256" },
      { name: "coolEnd", type: "uint64" },
      { name: "stakeStart", type: "uint64" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "workingOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "poke",
    inputs: [{ name: "list", type: "address[]" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Staked",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Poked",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "working", type: "uint256", indexed: false },
    ],
  },
] as const;

const DRY_SENDER: Address = "0x000000000000000000000000000000000000beef";
const MIN_GAS_BALANCE = 10n ** 15n; // 0.001 HYPE safety floor
const TX_GAS_CAP = 28_000_000n;

function normalizeKey(raw: string): Hex {
  const clean = raw.trim().startsWith("0x") ? raw.trim() : `0x${raw.trim()}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error("KEEPER_KEY must be 32 bytes of hex");
  }
  return clean as Hex;
}

function parseDeployment(raw: string): DeploymentAddresses {
  const d = JSON.parse(raw || "{}") as Record<string, unknown>;
  if (
    typeof d.pnthRouter !== "string" ||
    !isAddress(d.pnthRouter, { strict: false }) ||
    typeof d.indexVault !== "string" ||
    !isAddress(d.indexVault, { strict: false }) ||
    typeof d.staking !== "string" ||
    !isAddress(d.staking, { strict: false })
  ) {
    throw new Error("CANON_DEPLOYMENT_JSON must contain pnthRouter, indexVault, and staking addresses");
  }
  return {
    pnthRouter: getAddress(d.pnthRouter),
    indexVault: getAddress(d.indexVault),
    staking: getAddress(d.staking),
    deployedBlock: typeof d.deployedBlock === "string" ? d.deployedBlock : undefined,
  };
}

function countUsefulEvents(
  logs: ReadonlyArray<{ address: Address; topics: Hex[]; data: Hex }>,
  dep: DeploymentAddresses,
) {
  let routerMoved = false;
  let vaultMoved = false;
  let poked = 0;

  for (const log of logs) {
    const addr = log.address.toLowerCase();
    try {
      if (addr === dep.pnthRouter.toLowerCase()) {
        const ev = decodeEventLog({ abi: routerAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName === "LegExecuted" && ev.args.amount > 0n) routerMoved = true;
      } else if (addr === dep.indexVault.toLowerCase()) {
        const ev = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName === "BasketBuy" || ev.eventName === "Streamed") vaultMoved = true;
      } else if (addr === dep.staking.toLowerCase()) {
        const ev = decodeEventLog({ abi: stakingAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName === "Poked") poked += 1;
      }
    } catch {
      // Ignore unrelated events
    }
  }
  return { routerMoved, vaultMoved, poked };
}

async function runKeeperTick(env: Env) {
  const chainId = Number(env.CHAIN_ID || "99801");
  const rpcUrl = env.ELYSIUM_RPC || "https://testnet-rpc.elysium.kinetiq.xyz";
  const basketK = BigInt(Number(env.BASKET_K || "5"));
  const pokeBatchSize = Math.max(1, Number(env.POKE_BATCH || "10"));
  const pokeRiseBps = BigInt(Number(env.POKE_RISE_BPS || "100"));

  const dep = parseDeployment(env.CANON_DEPLOYMENT_JSON);
  const elysiumChain = {
    id: chainId,
    name: "Elysium Testnet",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;

  const publicClient = createPublicClient({
    chain: elysiumChain,
    transport: http(rpcUrl, { timeout: 10_000 }),
  });

  const account = env.KEEPER_KEY ? privateKeyToAccount(normalizeKey(env.KEEPER_KEY)) : null;
  const walletClient = account
    ? createWalletClient({
        account,
        chain: elysiumChain,
        transport: http(rpcUrl, { timeout: 15_000 }),
      })
    : null;

  const head = await publicClient.getBlockNumber();
  const defaultCursor = dep.deployedBlock && /^\d+$/.test(dep.deployedBlock) ? dep.deployedBlock : (head > 50_000n ? (head - 50_000n).toString() : "0");

  const rawState = await env.KEEPER_KV.get("keeper:state");
  const state: KeeperCursorState = rawState
    ? (JSON.parse(rawState) as KeeperCursorState)
    : { stakedCursor: defaultCursor, pokesSince: 0, sweep: 0, stakers: [] };

  // 1. Scan new Staked logs in bounded chunks
  const fromBlock = BigInt(state.stakedCursor);
  if (fromBlock <= head) {
    const known = new Set(state.stakers.map((a) => a.toLowerCase()));
    const step = 200_000n;
    for (let start = fromBlock; start <= head; start += step) {
      const end = start + step - 1n < head ? start + step - 1n : head;
      const logs = await publicClient.getContractEvents({
        address: dep.staking,
        abi: stakingAbi,
        eventName: "Staked",
        fromBlock: start,
        toBlock: end,
      });
      for (const l of logs) {
        const staker = l.args.account;
        if (staker && !known.has(staker.toLowerCase())) {
          known.add(staker.toLowerCase());
          state.stakers.push(getAddress(staker));
        }
      }
    }
    state.stakedCursor = (head + 1n).toString();
  }

  // 2. Pull recent pass tier changes from Worker 1 (optional)
  const flagged: Address[] = [];
  if (env.PASSPORT_WORKER_URL) {
    try {
      const feedRes = await fetch(
        `${env.PASSPORT_WORKER_URL.replace(/\/$/, "")}/passport/pokes?since=${state.pokesSince}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (feedRes.ok) {
        const feed = (await feedRes.json()) as { accounts?: string[]; until?: number };
        for (const a of feed.accounts ?? []) {
          if (isAddress(a, { strict: false })) flagged.push(getAddress(a));
        }
        if (typeof feed.until === "number") state.pokesSince = feed.until;
      }
    } catch {
      // Continue with staker rotation
    }
  }

  // 3. Rotate through up to 150 stakers + flagged accounts
  const sliceCount = Math.min(150, state.stakers.length);
  const rotated: Address[] = [];
  for (let i = 0; i < sliceCount; i++) {
    rotated.push(state.stakers[(state.sweep + i) % state.stakers.length]!);
  }
  state.sweep = state.stakers.length > 0 ? (state.sweep + sliceCount) % state.stakers.length : 0;

  const candidateMap = new Map<string, Address>();
  for (const a of [...flagged, ...rotated]) candidateMap.set(a.toLowerCase(), a);
  const candidates = [...candidateMap.values()];

  const toPoke: Address[] = [];
  if (candidates.length > 0) {
    const reads = await publicClient.multicall({
      allowFailure: true,
      contracts: candidates.flatMap((a) => [
        { address: dep.staking, abi: stakingAbi, functionName: "accounts", args: [a] } as const,
        { address: dep.staking, abi: stakingAbi, functionName: "workingOf", args: [a] } as const,
      ]),
    });
    for (let i = 0; i < candidates.length; i++) {
      const accRes = reads[2 * i];
      const nextRes = reads[2 * i + 1];
      if (accRes?.status !== "success" || nextRes?.status !== "success") continue;
      const accTuple = accRes.result as readonly [bigint, bigint, bigint, bigint, bigint];
      const working = accTuple[2];
      const next = nextRes.result as bigint;
      if (next < working) {
        toPoke.push(candidates[i]!);
      } else if (next > working && (working === 0n || (next - working) * 10_000n >= working * pokeRiseBps)) {
        toPoke.push(candidates[i]!);
      }
    }
  }

  // 4. Simulate router.run() + vault.rebalance(k) together in order
  const sender = account?.address ?? DRY_SENDER;
  const simPair = await publicClient.simulateCalls({
    account: sender,
    validation: false,
    calls: [
      { to: dep.pnthRouter, abi: routerAbi, functionName: "run", args: [] },
      { to: dep.indexVault, abi: vaultAbi, functionName: "rebalance", args: [basketK] },
    ],
  });

  const runLogs = (simPair.results[0]?.logs ?? []) as Array<{ address: Address; topics: Hex[]; data: Hex }>;
  const rebLogs = (simPair.results[1]?.logs ?? []) as Array<{ address: Address; topics: Hex[]; data: Hex }>;
  const shouldRunRouter =
    simPair.results[0]?.status === "success" && countUsefulEvents(runLogs, dep).routerMoved;
  const shouldRebalance =
    simPair.results[1]?.status === "success" && countUsefulEvents(rebLogs, dep).vaultMoved;

  const sent: Array<{ kind: string; tx: Hex }> = [];
  let keeperBalance = 0n;
  if (account) {
    keeperBalance = await publicClient.getBalance({ address: account.address });
  }

  if (walletClient && account && keeperBalance >= MIN_GAS_BALANCE) {
    if (shouldRunRouter) {
      const est = await publicClient.estimateContractGas({
        address: dep.pnthRouter,
        abi: routerAbi,
        functionName: "run",
        account,
      });
      const gas = (est * 3n) / 2n > TX_GAS_CAP ? TX_GAS_CAP : (est * 3n) / 2n;
      const hash = await walletClient.writeContract({
        address: dep.pnthRouter,
        abi: routerAbi,
        functionName: "run",
        gas,
      });
      await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      sent.push({ kind: "run", tx: hash });
    }

    if (shouldRebalance) {
      const est = await publicClient.estimateContractGas({
        address: dep.indexVault,
        abi: vaultAbi,
        functionName: "rebalance",
        args: [basketK],
        account,
      });
      const gas = (est * 3n) / 2n > TX_GAS_CAP ? TX_GAS_CAP : (est * 3n) / 2n;
      const hash = await walletClient.writeContract({
        address: dep.indexVault,
        abi: vaultAbi,
        functionName: "rebalance",
        args: [basketK],
        gas,
      });
      await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      sent.push({ kind: "rebalance", tx: hash });
    }

    for (let i = 0; i < toPoke.length; i += pokeBatchSize) {
      const batch = toPoke.slice(i, i + pokeBatchSize);
      const hash = await walletClient.writeContract({
        address: dep.staking,
        abi: stakingAbi,
        functionName: "poke",
        args: [batch],
      });
      await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      sent.push({ kind: `poke(${batch.length})`, tx: hash });
    }
  }

  state.lastRunAt = new Date().toISOString();
  state.lastSentCount = sent.length;
  await env.KEEPER_KV.put("keeper:state", JSON.stringify(state));

  return {
    ok: true,
    mode: walletClient ? "live" : "dry-run",
    blockNumber: head.toString(),
    keeper: account?.address ?? null,
    keeperBalanceHype: account ? formatEther(keeperBalance) : null,
    stakersTracked: state.stakers.length,
    shouldRunRouter,
    shouldRebalance,
    pokesQueued: toPoke.length,
    sent,
  };
}

export default {
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runKeeperTick(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      const rawState = await env.KEEPER_KV.get("keeper:state");
      const state = rawState ? (JSON.parse(rawState) as KeeperCursorState) : null;
      return new Response(
        JSON.stringify({
          ok: true,
          worker: "canon-keeper-worker",
          schedule: "*/5 * * * *",
          state,
        }),
        { status: 200, headers },
      );
    }

    if (request.method === "POST" && url.pathname === "/run") {
      if (env.TRIGGER_TOKEN) {
        const auth = request.headers.get("authorization") || "";
        if (auth !== `Bearer ${env.TRIGGER_TOKEN}`) {
          return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401, headers });
        }
      }
      try {
        const report = await runKeeperTick(env);
        return new Response(JSON.stringify(report), { status: 200, headers });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers });
      }
    }

    return new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404, headers });
  },
};
