import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  erc20Abi,
  formatEther,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  verifyTypedData,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  PASSPORT_KV: KvNamespaceLike;
  CHAIN_ID?: string;
  ELYSIUM_RPC?: string;
  HYPEREVM_RPC?: string;
  HL_INFO_URL?: string;
  REGISTRY_ADDRESS: string;
  TESTNET_MIN_TIER?: string;
  ATTESTOR_KEY: string;
  RELAYER_KEY: string;
  PEPPER_SALT: string;
}

const E8 = 100_000_000n;
const BPS = 10_000n;
const DAY_MS = 86_400_000;
const LINK_TTL_SEC = 15 * 60;
const ATTESTATION_TTL_SEC = 7 * 24 * 3600;
const ATTESTATION_DEADLINE_SEC = 3600;
const UPGRADE_CONFIRM_GAP_SEC = 20 * 3600;

const HYPEREVM_CONTRACTS = {
  KHYPE: "0xfD739d4e423301CE9385c1fb8850539D657C296D" as Address,
  STAKING_ACCOUNTANT: "0x9209648Ec9D448EF57116B73A2f081835643dc7A" as Address,
  WHYPE: "0x5555555555555555555555555555555555555555" as Address,
  KNTQ: "0x000000000000780555bD0BCA3791f89f9542c2d6" as Address,
  HYPURR: "0x9125E2d6827a00B0F8330D6ef7BEF07730Bac685" as Address,
  MULTICALL3: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address,
} as const;

const LINK_PURPOSE =
  "HYPE Passport: link this Hyperliquid account to this Elysium wallet. Read-only; no funds move.";

const passportDomain = (verifyingContract: Address) =>
  ({ name: "HYPE Passport", version: "1", verifyingContract }) as const;

const passportTypes = {
  Link: [
    { name: "purpose", type: "string" },
    { name: "hyperliquidAccount", type: "address" },
    { name: "elysiumAccount", type: "address" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "chainId", type: "uint256" },
  ],
  Attestation: [
    { name: "account", type: "address" },
    { name: "hlKey", type: "bytes32" },
    { name: "tier", type: "uint8" },
    { name: "stamps", type: "uint32" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

const registryAbi = [
  { type: "function", name: "ATTESTOR", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "retired", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "lastIssuedAt", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "accountOfHlKey", inputs: [{ name: "k", type: "bytes32" }], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "rebindableAt", inputs: [{ name: "k", type: "bytes32" }], outputs: [{ type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "isValid", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "multiplierOf", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "passportOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "hlKey", type: "bytes32" },
          { name: "tier", type: "uint8" },
          { name: "stamps", type: "uint32" },
          { name: "issuedAt", type: "uint64" },
          { name: "expiry", type: "uint64" },
          { name: "linkedAt", type: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "submit",
    inputs: [
      {
        name: "a",
        type: "tuple",
        components: [
          { name: "account", type: "address" },
          { name: "hlKey", type: "bytes32" },
          { name: "tier", type: "uint8" },
          { name: "stamps", type: "uint32" },
          { name: "issuedAt", type: "uint64" },
          { name: "expiry", type: "uint64" },
          { name: "deadline", type: "uint64" },
          { name: "chainId", type: "uint256" },
        ],
      },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

type StoredChallenge = {
  nonce: Hex;
  elysium: Address;
  hl: Address;
  deadline: number;
  used: boolean;
};

type StoredBinding = {
  elysium: Address;
  hl: Address;
  hlKey: Hex;
  history: Array<{ tier: number; stamps: number; at: number }>;
};

type PokeQueue = Array<{ account: Address; at: number }>;

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

function normalizeHex32(raw: string, label: string): Hex {
  const clean = raw.trim().startsWith("0x") ? raw.trim() : `0x${raw.trim()}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`${label} must be 32 bytes of hex`);
  }
  return clean as Hex;
}

function randomHex32(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function toE8(decimal: string | undefined | null): bigint {
  if (!decimal) return 0n;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(decimal).trim());
  if (!m) return 0n;
  const [, sign, whole = "0", frac = ""] = m;
  const val = BigInt(whole) * E8 + BigInt(frac.padEnd(8, "0").slice(0, 8));
  return sign === "-" ? -val : val;
}

const pos = (v: bigint) => (v > 0n ? v : 0n);

async function hlPost<T>(hlUrl: string, payload: Record<string, unknown>): Promise<T> {
  const r = await fetch(hlUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) throw new Error(`HL_${r.status}`);
  return (await r.json()) as T;
}

async function scoreHyperliquidAccount(hlUrl: string, evmRpc: string, user: Address, nowMs: number) {
  const lower = user.toLowerCase();
  const [roleRes, multiSig, spot, delegator, borrowLend, ledger] = await Promise.all([
    hlPost<{ role: string; data?: { user?: string } }>(hlUrl, { type: "userRole", user: lower }),
    hlPost<unknown>(hlUrl, { type: "userToMultiSigSigners", user: lower }),
    hlPost<{ balances?: Array<{ token: number; total: string }> }>(hlUrl, { type: "spotClearinghouseState", user: lower }),
    hlPost<{ delegated?: string; undelegated?: string; totalPendingWithdrawal?: string }>(hlUrl, {
      type: "delegatorSummary",
      user: lower,
    }),
    hlPost<{ tokenToState?: Array<[number, { borrow?: { value?: string } }]> }>(hlUrl, {
      type: "borrowLendUserState",
      user: lower,
    }).catch(() => ({ tokenToState: [] })),
    hlPost<Array<{ time?: number }>>(hlUrl, {
      type: "userNonFundingLedgerUpdates",
      user: lower,
      startTime: 0,
    }).catch(() => []),
  ]);

  if (roleRes.role === "agent") return { ok: false as const, error: "AGENT_WALLET", status: 400 };
  if (roleRes.role !== "user" && roleRes.role !== "missing") {
    return { ok: false as const, error: "NOT_A_SIGNING_ACCOUNT", status: 400 };
  }
  if (multiSig !== null) return { ok: false as const, error: "MULTISIG_UNSUPPORTED", status: 400 };

  // Read HyperEVM native HYPE + WHYPE + kHYPE
  let evmNative = 0n;
  let evmWhype = 0n;
  let evmKhypeInHype = 0n;
  let evmFailed = false;
  try {
    const evmClient = createPublicClient({ transport: http(evmRpc, { timeout: 6_000 }) });
    const [nat, whype, khype] = await Promise.all([
      evmClient.getBalance({ address: user }),
      evmClient.readContract({ address: HYPEREVM_CONTRACTS.WHYPE, abi: erc20Abi, functionName: "balanceOf", args: [user] }),
      evmClient.readContract({ address: HYPEREVM_CONTRACTS.KHYPE, abi: erc20Abi, functionName: "balanceOf", args: [user] }),
    ]);
    evmNative = nat;
    evmWhype = whype;
    if (khype > 0n) {
      const rate = await evmClient
        .readContract({
          address: HYPEREVM_CONTRACTS.STAKING_ACCOUNTANT,
          abi: [{ type: "function", name: "kHYPEToHYPE", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
          functionName: "kHYPEToHYPE",
          args: [10n ** 18n],
        })
        .catch(() => 10n ** 18n);
      evmKhypeInHype = (khype * rate) / 10n ** 18n;
    }
  } catch {
    evmFailed = true;
  }

  const weiToE8 = (w: bigint) => (w > 0n ? w / 10n ** 10n : 0n);
  const stakedE8 = pos(toE8(delegator.delegated)) + pos(toE8(delegator.undelegated));
  const spotHypeE8 = (spot.balances ?? [])
    .filter((b) => b.token === 150)
    .reduce((s, b) => s + pos(toE8(b.total)), 0n);
  const borrowedE8 = (borrowLend.tokenToState ?? [])
    .filter(([tok]) => tok === 150)
    .reduce((s, [, st]) => s + pos(toE8(st?.borrow?.value)), 0n);

  const liquidE8 =
    pos(toE8(delegator.totalPendingWithdrawal)) +
    pos(spotHypeE8 - borrowedE8) +
    weiToE8(evmNative) +
    weiToE8(evmWhype);
  const khypeE8 = weiToE8(evmKhypeInHype);

  const scoreE8 = (stakedE8 * 10_000n + liquidE8 * 5_000n + khypeE8 * 5_000n) / BPS;
  const earliestMs =
    Array.isArray(ledger) && ledger.length > 0 && typeof ledger[0]?.time === "number" ? ledger[0].time : null;
  const ageMs = earliestMs === null ? 0 : Math.max(0, nowMs - earliestMs);

  let tier = 0;
  if (scoreE8 >= 10n * E8) tier = 1;
  if (scoreE8 >= 100n * E8 && ageMs >= 30 * DAY_MS) tier = 2;
  if (scoreE8 >= 1_000n * E8 && ageMs >= 90 * DAY_MS) tier = 3;
  if (roleRes.role === "missing" && tier > 1) tier = 1;

  let stamps = 0;
  if (stakedE8 >= 10n * E8) stamps |= 1 << 0;
  if (khypeE8 >= 10n * E8) stamps |= 1 << 1;
  if (ageMs >= 365 * DAY_MS) stamps |= 1 << 3;
  if (ageMs >= 30 * DAY_MS) stamps |= 1 << 7;

  const reasons: string[] = [];
  if (tier === 0 && scoreE8 < 10n * E8) reasons.push("SCORE_BELOW_10");
  else if (tier === 1) {
    if (scoreE8 < 100n * E8) reasons.push("SCORE_BELOW_100");
    if (ageMs < 30 * DAY_MS) reasons.push("ACCOUNT_AGE_BELOW_30D");
    if (earliestMs === null || roleRes.role === "missing") reasons.push("NO_HYPERCORE_HISTORY");
  } else if (tier === 2) {
    if (scoreE8 < 1_000n * E8) reasons.push("SCORE_BELOW_1000");
    if (ageMs < 90 * DAY_MS) reasons.push("ACCOUNT_AGE_BELOW_90D");
  }
  if (evmFailed) reasons.push("PARTIAL_EVM_READ");

  return { ok: true as const, tier, stamps, reasons };
}

async function appendPoke(kv: KvNamespaceLike, account: Address, nowSec: number) {
  const raw = await kv.get("pokes:list");
  const list: PokeQueue = raw ? (JSON.parse(raw) as PokeQueue) : [];
  const cutoff = nowSec - 7 * 24 * 3600;
  const filtered = list.filter((p) => p.at >= cutoff && p.account.toLowerCase() !== account.toLowerCase());
  filtered.push({ account, at: nowSec });
  await kv.put("pokes:list", JSON.stringify(filtered));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "") || "/";

    const chainId = Number(env.CHAIN_ID || "99801");
    const elysiumRpc = env.ELYSIUM_RPC || "https://testnet-rpc.elysium.kinetiq.xyz";
    const hyperEvmRpc = env.HYPEREVM_RPC || "https://rpc.hyperliquid.xyz/evm";
    const hlInfoUrl = env.HL_INFO_URL || "https://api.hyperliquid.xyz/info";

    if (!isAddress(env.REGISTRY_ADDRESS || "", { strict: false }) || env.REGISTRY_ADDRESS === zeroAddress) {
      return jsonResponse({ ok: false, error: "REGISTRY_NOT_CONFIGURED" }, 503);
    }

    const registry = getAddress(env.REGISTRY_ADDRESS);
    const elysiumChain = {
      id: chainId,
      name: "Elysium Testnet",
      nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
      rpcUrls: { default: { http: [elysiumRpc] } },
    } as const;

    const publicClient = createPublicClient({
      chain: elysiumChain,
      transport: http(elysiumRpc, { timeout: 8_000 }),
    });

    let attestorAccount;
    let relayerAccount;
    let pepper: Hex;
    try {
      attestorAccount = privateKeyToAccount(normalizeHex32(env.ATTESTOR_KEY, "ATTESTOR_KEY"));
      relayerAccount = privateKeyToAccount(normalizeHex32(env.RELAYER_KEY, "RELAYER_KEY"));
      pepper = normalizeHex32(env.PEPPER_SALT, "PEPPER_SALT");
    } catch (e) {
      return jsonResponse({ ok: false, error: "WORKER_KEYS_MISSING", detail: (e as Error).message }, 503);
    }

    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: elysiumChain,
      transport: http(elysiumRpc, { timeout: 12_000 }),
    });

    // 1. Health check
    if (request.method === "GET" && (pathname === "/health" || pathname === "/passport/health")) {
      try {
        const [blockNumber, onChainAttestor, retired, relayerBal] = await Promise.all([
          publicClient.getBlockNumber(),
          publicClient.readContract({ address: registry, abi: registryAbi, functionName: "ATTESTOR" }),
          publicClient.readContract({ address: registry, abi: registryAbi, functionName: "retired" }),
          publicClient.getBalance({ address: relayerAccount.address }),
        ]);
        const attestorMatches = onChainAttestor.toLowerCase() === attestorAccount.address.toLowerCase();
        const ok = attestorMatches && !retired && relayerBal > 0n;
        return jsonResponse(
          {
            ok,
            chainId,
            blockNumber: blockNumber.toString(),
            registry,
            attestor: attestorAccount.address,
            attestorMatches,
            retired,
            relayer: relayerAccount.address,
            relayerBalanceHype: formatEther(relayerBal),
          },
          ok ? 200 : 503,
        );
      } catch (e) {
        return jsonResponse({ ok: false, error: (e as Error).message }, 503);
      }
    }

    // 2. Stats
    if (request.method === "GET" && pathname === "/passport/stats") {
      const issued = Number((await env.PASSPORT_KV.get("stats:issued")) || "0");
      return jsonResponse({ issued, registry });
    }

    // 3. Pokes feed for Keeper Worker
    if (request.method === "GET" && pathname === "/passport/pokes") {
      const since = Number(url.searchParams.get("since") || "0");
      const nowSec = Math.floor(Date.now() / 1000);
      const raw = await env.PASSPORT_KV.get("pokes:list");
      const list: PokeQueue = raw ? (JSON.parse(raw) as PokeQueue) : [];
      const accounts = list.filter((p) => p.at > since).map((p) => p.account);
      return jsonResponse({ accounts, until: nowSec });
    }

    // 4. Read single passport
    if (request.method === "GET" && pathname.startsWith("/passport/0x")) {
      const addrRaw = pathname.slice("/passport/".length);
      if (!isAddress(addrRaw, { strict: false })) {
        return jsonResponse({ error: "INVALID_ADDRESS" }, 400);
      }
      const account = getAddress(addrRaw);
      const [p, valid, mult] = await Promise.all([
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: "passportOf", args: [account] }),
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: "isValid", args: [account] }),
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: "multiplierOf", args: [account] }),
      ]);
      return jsonResponse({
        account,
        valid,
        tier: Number(p.tier),
        stamps: Number(p.stamps),
        issuedAt: Number(p.issuedAt),
        expiry: Number(p.expiry),
        multiplier: (Number(mult) / 1e18).toFixed(2),
      });
    }

    // 5. Create Link Challenge
    if (request.method === "POST" && pathname === "/passport/challenge") {
      const body = (await request.json().catch(() => ({}))) as {
        elysiumAccount?: string;
        hyperliquidAccount?: string;
      };
      if (
        !body.elysiumAccount ||
        !body.hyperliquidAccount ||
        !isAddress(body.elysiumAccount, { strict: false }) ||
        !isAddress(body.hyperliquidAccount, { strict: false }) ||
        body.elysiumAccount.toLowerCase() === zeroAddress ||
        body.hyperliquidAccount.toLowerCase() === zeroAddress
      ) {
        return jsonResponse({ error: "INVALID_ADDRESS" }, 400);
      }

      const elysium = getAddress(body.elysiumAccount);
      const hl = getAddress(body.hyperliquidAccount);
      const hlKey = keccak256(encodePacked(["bytes32", "address"], [pepper, hl]));
      const nowSec = Math.floor(Date.now() / 1000);

      // Pre-flight check on Hyperliquid signing role + on-chain 1:1 bindings
      const [roleRes, multiSig, existingPass, boundHolder, rebindAt] = await Promise.all([
        hlPost<{ role: string }>(hlInfoUrl, { type: "userRole", user: hl.toLowerCase() }),
        hlPost<unknown>(hlInfoUrl, { type: "userToMultiSigSigners", user: hl.toLowerCase() }),
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: "passportOf", args: [elysium] }),
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: "accountOfHlKey", args: [hlKey] }),
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: "rebindableAt", args: [hlKey] }),
      ]);

      if (roleRes.role === "agent") return jsonResponse({ error: "AGENT_WALLET" }, 400);
      if (roleRes.role !== "user" && roleRes.role !== "missing") {
        return jsonResponse({ error: "NOT_A_SIGNING_ACCOUNT" }, 400);
      }
      if (multiSig !== null) return jsonResponse({ error: "MULTISIG_UNSUPPORTED" }, 400);

      if (
        existingPass.hlKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" &&
        existingPass.hlKey.toLowerCase() !== hlKey.toLowerCase() &&
        Number(existingPass.expiry) + 7 * 86400 > nowSec
      ) {
        return jsonResponse({ error: "ACCOUNT_ALREADY_LINKED" }, 409);
      }
      if (boundHolder !== zeroAddress && boundHolder.toLowerCase() !== elysium.toLowerCase()) {
        return jsonResponse({ error: "HL_ALREADY_LINKED" }, 409);
      }
      if (boundHolder === zeroAddress && Number(rebindAt) > nowSec) {
        return jsonResponse({ error: "REBIND_COOLDOWN" }, 409);
      }

      const nonce = randomHex32();
      const deadline = nowSec + LINK_TTL_SEC;
      const stored: StoredChallenge = { nonce, elysium, hl, deadline, used: false };
      await env.PASSPORT_KV.put(`challenge:${nonce.toLowerCase()}`, JSON.stringify(stored), {
        expirationTtl: LINK_TTL_SEC + 60,
      });

      const message = {
        purpose: LINK_PURPOSE,
        hyperliquidAccount: hl,
        elysiumAccount: elysium,
        nonce,
        deadline,
        chainId,
      };

      return jsonResponse({
        nonce,
        typedData: {
          domain: passportDomain(registry),
          types: { Link: passportTypes.Link },
          primaryType: "Link",
          message,
        },
      });
    }

    // 6. Verify Signatures, Score Hyperliquid HYPE, Sign & Relay Pass
    if (request.method === "POST" && pathname === "/passport/verify") {
      const body = (await request.json().catch(() => ({}))) as {
        nonce?: string;
        hlSignature?: string;
        elysiumSignature?: string;
        relay?: boolean;
      };
      if (!body.nonce || !isHex(body.nonce) || body.nonce.length !== 66) {
        return jsonResponse({ error: "CHALLENGE_NOT_FOUND" }, 400);
      }

      const key = `challenge:${body.nonce.toLowerCase()}`;
      const rawCh = await env.PASSPORT_KV.get(key);
      if (!rawCh) return jsonResponse({ error: "CHALLENGE_NOT_FOUND" }, 400);

      const ch = JSON.parse(rawCh) as StoredChallenge;
      const nowSec = Math.floor(Date.now() / 1000);
      if (ch.used) return jsonResponse({ error: "CHALLENGE_USED" }, 400);
      if (nowSec > ch.deadline) return jsonResponse({ error: "CHALLENGE_EXPIRED" }, 400);

      const linkMsg = {
        purpose: LINK_PURPOSE,
        hyperliquidAccount: ch.hl,
        elysiumAccount: ch.elysium,
        nonce: ch.nonce,
        deadline: BigInt(ch.deadline),
        chainId: BigInt(chainId),
      };

      const checkSig = async (signer: Address, sig: string | undefined) => {
        if (!sig || !isHex(sig)) return false;
        try {
          return await verifyTypedData({
            address: signer,
            domain: passportDomain(registry),
            types: { Link: passportTypes.Link },
            primaryType: "Link",
            message: linkMsg,
            signature: sig,
          });
        } catch {
          return false;
        }
      };

      if (!(await checkSig(ch.hl, body.hlSignature))) {
        return jsonResponse({ error: "BAD_HL_SIGNATURE" }, 400);
      }
      const sameWallet = ch.hl.toLowerCase() === ch.elysium.toLowerCase();
      if (!sameWallet && !(await checkSig(ch.elysium, body.elysiumSignature))) {
        return jsonResponse({ error: "BAD_ELYSIUM_SIGNATURE" }, 400);
      }

      // Mark challenge used
      await env.PASSPORT_KV.put(key, JSON.stringify({ ...ch, used: true }), { expirationTtl: 300 });

      const scored = await scoreHyperliquidAccount(hlInfoUrl, hyperEvmRpc, ch.hl, Date.now());
      if (!scored.ok) return jsonResponse({ error: scored.error }, scored.status);

      const minTestTier = Math.min(3, Math.max(0, Number(env.TESTNET_MIN_TIER || "0")));
      const finalTier = Math.max(scored.tier, minTestTier);

      if (finalTier === 0) {
        return jsonResponse({ tier: 0, stamps: scored.stamps, reasons: scored.reasons });
      }

      const hlKey = keccak256(encodePacked(["bytes32", "address"], [pepper, ch.hl]));
      const [lastIssued, block] = await Promise.all([
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: "lastIssuedAt", args: [ch.elysium] }),
        publicClient.getBlock(),
      ]);

      const chainNow = Math.max(nowSec, Number(block.timestamp));
      const issuedAt = Math.max(chainNow, Number(lastIssued) + 1);
      const expiry = issuedAt + ATTESTATION_TTL_SEC;
      const deadline = chainNow + ATTESTATION_DEADLINE_SEC;

      const attestation = {
        account: ch.elysium,
        hlKey,
        tier: finalTier,
        stamps: scored.stamps,
        issuedAt: BigInt(issuedAt),
        expiry: BigInt(expiry),
        deadline: BigInt(deadline),
        chainId: BigInt(chainId),
      };

      const sig = await attestorAccount.signTypedData({
        domain: passportDomain(registry),
        types: { Attestation: passportTypes.Attestation },
        primaryType: "Attestation",
        message: attestation,
      });

      let txHash: Hex | null = null;
      if (body.relay !== false) {
        txHash = await walletClient.writeContract({
          address: registry,
          abi: registryAbi,
          functionName: "submit",
          args: [attestation, sig],
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
      }

      const binding: StoredBinding = {
        elysium: ch.elysium,
        hl: ch.hl,
        hlKey,
        history: [{ tier: finalTier, stamps: scored.stamps, at: chainNow }],
      };
      await env.PASSPORT_KV.put(`binding:${ch.elysium.toLowerCase()}`, JSON.stringify(binding));
      const prevIssued = Number((await env.PASSPORT_KV.get("stats:issued")) || "0");
      await env.PASSPORT_KV.put("stats:issued", String(prevIssued + 1));
      await appendPoke(env.PASSPORT_KV, ch.elysium, chainNow);

      return jsonResponse({
        tier: finalTier,
        stamps: scored.stamps,
        txHash,
        attestation: {
          ...attestation,
          issuedAt,
          expiry,
          deadline,
          chainId,
        },
        signature: sig,
      });
    }

    // 7. Refresh Existing Pass
    if (request.method === "POST" && pathname === "/passport/refresh") {
      const body = (await request.json().catch(() => ({}))) as { elysiumAccount?: string };
      if (!body.elysiumAccount || !isAddress(body.elysiumAccount, { strict: false })) {
        return jsonResponse({ error: "INVALID_ADDRESS" }, 400);
      }
      const elysium = getAddress(body.elysiumAccount);
      const rawBind = await env.PASSPORT_KV.get(`binding:${elysium.toLowerCase()}`);
      if (!rawBind) return jsonResponse({ error: "NOT_LINKED" }, 404);

      const bind = JSON.parse(rawBind) as StoredBinding;
      const scored = await scoreHyperliquidAccount(hlInfoUrl, hyperEvmRpc, bind.hl, Date.now());
      if (!scored.ok) return jsonResponse({ error: scored.error }, scored.status);

      const [onChainPass, lastIssued, block] = await Promise.all([
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: "passportOf", args: [elysium] }),
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: "lastIssuedAt", args: [elysium] }),
        publicClient.getBlock(),
      ]);

      const nowSec = Math.max(Math.floor(Date.now() / 1000), Number(block.timestamp));
      const minTestTier = Math.min(3, Math.max(0, Number(env.TESTNET_MIN_TIER || "0")));
      const rawTier = Math.max(scored.tier, minTestTier);

      // Downgrade immediately; upgrade only when supported for >= 20h
      const curTier = Number(onChainPass.tier);
      const cutoff = nowSec - UPGRADE_CONFIRM_GAP_SEC;
      const anchor = bind.history.filter((c) => c.at <= cutoff).at(-1);
      const windowChecks = anchor
        ? [anchor, ...bind.history.filter((c) => c.at > anchor.at), { tier: rawTier, stamps: scored.stamps, at: nowSec }]
        : [];
      const sustainedTier = windowChecks.length > 0 ? Math.min(...windowChecks.map((c) => c.tier)) : curTier;
      const confirmedTier = rawTier <= curTier ? rawTier : Math.max(curTier, Math.min(rawTier, sustainedTier));

      const issuedAt = Math.max(nowSec, Number(lastIssued) + 1);
      const expiry = issuedAt + ATTESTATION_TTL_SEC;
      const deadline = nowSec + ATTESTATION_DEADLINE_SEC;

      const attestation = {
        account: elysium,
        hlKey: bind.hlKey,
        tier: confirmedTier,
        stamps: scored.stamps,
        issuedAt: BigInt(issuedAt),
        expiry: BigInt(expiry),
        deadline: BigInt(deadline),
        chainId: BigInt(chainId),
      };

      const sig = await attestorAccount.signTypedData({
        domain: passportDomain(registry),
        types: { Attestation: passportTypes.Attestation },
        primaryType: "Attestation",
        message: attestation,
      });

      const txHash = await walletClient.writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "submit",
        args: [attestation, sig],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });

      const updatedHistory = [...bind.history.slice(-15), { tier: rawTier, stamps: scored.stamps, at: nowSec }];
      await env.PASSPORT_KV.put(
        `binding:${elysium.toLowerCase()}`,
        JSON.stringify({ ...bind, history: updatedHistory }),
      );
      if (confirmedTier !== curTier) {
        await appendPoke(env.PASSPORT_KV, elysium, nowSec);
      }

      return jsonResponse({ tier: confirmedTier, stamps: scored.stamps, txHash });
    }

    return jsonResponse({ error: "NOT_FOUND" }, 404);
  },
};
