import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { createServer as createViteServer } from "vite";
import { buildEmbeddedDelphi } from "./src/lib/delphi.ts";
import { buildTestnetKeysPdf } from "./src/lib/testnet-keys-pdf.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const RPC_URL = process.env.VITE_RPC_URL || "https://testnet-rpc.elysium.kinetiq.xyz";
const EXPLORER = "https://elysium.kinetiq.xyz/testnet-explorer";

const elysiumChain = {
  id: 99801,
  name: "Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

const publicClient = createPublicClient({
  chain: elysiumChain,
  transport: http(RPC_URL, { timeout: 3_500 }),
});

type ServerDeployment = {
  chainId: number;
  launchpad: Address;
  ascendLaunchpad?: Address;
  usdc: Address;
  burnSink: Address;
  passportRegistry: Address;
  covenantFactory: Address;
  pnth: Address;
  pnthPool: Hex;
  pnthRouter: Address;
  constituentRegistry: Address;
  staking: Address;
  indexVault: Address;
  swapper?: Address;
  drip?: Address;
  team?: Address;
  teamBps?: number;
  tokenName?: string;
  tokenSymbol?: string;
  customActive?: boolean;
  deployedBlock?: string;
  activatedAt?: string;
};

type Candidate = {
  token: string;
  poolId: string;
  symbol: string;
  verdict: string;
  headline: string;
  realUsdc: string;
  launchedAt: number;
  rank: number;
};

type RoundVoteFile = {
  round: number;
  chainId: number;
  opensAt: number;
  closesAt: number;
  seats: number;
  method: string;
  source: { delphiRound: number; scannedAt: string };
  candidates: Candidate[];
};

type Ballot = {
  voter: Address;
  coins: Hex[];
  weight: number;
  staked: string;
  tier: number;
  signedAt: number;
  signature: Hex;
  receivedAt: number;
};

const BALLOT_TYPES_U64 = {
  Ballot: [
    { name: "round", type: "uint256" },
    { name: "voter", type: "address" },
    { name: "coins", type: "address[]" },
    { name: "signedAt", type: "uint64" },
  ],
} as const;

const BALLOT_TYPES_U256 = {
  Ballot: [
    { name: "round", type: "uint256" },
    { name: "voter", type: "address" },
    { name: "coins", type: "address[]" },
    { name: "signedAt", type: "uint256" },
  ],
} as const;

const erc20BalanceAbi = [
  { type: "function", name: "balanceOf", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

const stakingBalanceAbi = [
  { type: "function", name: "balanceOf", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

const passportTierAbi = [
  { type: "function", name: "tierOf", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint8" }], stateMutability: "view" },
] as const;

const workerTelemetryAbi = parseAbi([
  "function runCount() view returns (uint256)",
  "function activeId() view returns (uint256)",
  "function proposalCount() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function ATTESTOR() view returns (address)",
  "function retired() view returns (bool)",
]);

async function readJson<T>(relPath: string): Promise<T> {
  const raw = await fs.readFile(path.join(__dirname, relPath), "utf8");
  return JSON.parse(raw) as T;
}

function validateDeploymentPayload(body: unknown): ServerDeployment | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  if (raw.chainId !== 99801) return null;
  if (typeof raw.pnthPool !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(raw.pnthPool)) return null;

  const required = [
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
  ] as const;

  const normalized: Record<string, unknown> = {
    chainId: 99801,
    pnthPool: raw.pnthPool as Hex,
  };

  for (const k of required) {
    const val = raw[k];
    if (typeof val !== "string" || !isAddress(val, { strict: false })) return null;
    normalized[k] = getAddress(val);
  }

  const optionalAddr = ["ascendLaunchpad", "swapper", "drip", "team"] as const;
  for (const k of optionalAddr) {
    const val = raw[k];
    if (typeof val === "string" && isAddress(val, { strict: false })) {
      normalized[k] = getAddress(val);
    }
  }

  if (typeof raw.teamBps === "number" && Number.isFinite(raw.teamBps)) {
    normalized.teamBps = raw.teamBps;
  }
  if (typeof raw.tokenName === "string") normalized.tokenName = raw.tokenName.slice(0, 40);
  if (typeof raw.tokenSymbol === "string") normalized.tokenSymbol = raw.tokenSymbol.slice(0, 16);
  if (typeof raw.deployedBlock === "string" && /^\d+$/.test(raw.deployedBlock)) {
    normalized.deployedBlock = raw.deployedBlock;
  }
  normalized.customActive = true;
  normalized.activatedAt = typeof raw.activatedAt === "string" ? raw.activatedAt : new Date().toISOString();

  return normalized as ServerDeployment;
}

async function verifyBallotSignature(params: {
  voterAddr: Address;
  chainId: number;
  round: number;
  coins: Hex[];
  signedAt: number;
  signature: Hex;
}): Promise<boolean> {
  const domainNames = ["CANON Ballot", "PANTHEON Trials", "PantheonTrials"];
  const typeVariants = [BALLOT_TYPES_U64, BALLOT_TYPES_U256];
  for (const name of domainNames) {
    for (const types of typeVariants) {
      try {
        const ok = await verifyTypedData({
          address: params.voterAddr,
          domain: { name, version: "1", chainId: BigInt(params.chainId) },
          types,
          primaryType: "Ballot",
          message: {
            round: BigInt(params.round),
            voter: params.voterAddr,
            coins: params.coins,
            signedAt: BigInt(params.signedAt),
          },
          signature: params.signature,
        });
        if (ok) return true;
      } catch {
        // Try next domain/type variant
      }
    }
  }
  return false;
}

async function startServer() {
  const sharedDeployment = await readJson<ServerDeployment>("src/data/deployments/elysium-testnet.json");
  const activeDeploymentRel = "src/data/deployments/active-deployment.json";
  const activeDeploymentAbs = path.join(__dirname, activeDeploymentRel);

  let activeDeployment: ServerDeployment = sharedDeployment;
  let customActive = false;

  try {
    const saved = await readJson<unknown>(activeDeploymentRel);
    const valid = validateDeploymentPayload(saved);
    if (valid && valid.pnth.toLowerCase() !== sharedDeployment.pnth.toLowerCase()) {
      activeDeployment = valid;
      customActive = true;
    }
  } catch {
    // No custom deployment file yet
  }

  const round4 = await readJson<{
    round: number;
    scannedAt: string;
    rules: string;
    symbols: string[];
    tokens: string[];
    weightsBps: number[];
    excluded: Array<{ symbol: string; token: string; why: string }>;
    ranking: Array<{
      symbol: string;
      token: string;
      verdict: string;
      usdcVolume: number;
      realVolume: number;
      headline?: string;
    }>;
    vote?: { ballots?: Ballot[] };
  }>("src/data/deployments/trials/round-4.json");

  const round5 = await readJson<RoundVoteFile>("src/data/deployments/trials/round-5.vote.json");
  const delphiSnapshot = buildEmbeddedDelphi();

  const round5Ballots = new Map<string, Ballot>();
  const disputes: Array<{ token: string; message: string; contact?: string; at: string }> = [];

  function tallyRound(r: RoundVoteFile, ballots: Ballot[]) {
    const counts = new Map<string, { votes: number; voters: number }>();
    for (const c of r.candidates) counts.set(c.token.toLowerCase(), { votes: 0, voters: 0 });
    for (const b of ballots) {
      const seen = new Set<string>();
      for (const coin of b.coins) {
        const k = coin.toLowerCase();
        if (seen.has(k) || !counts.has(k)) continue;
        seen.add(k);
        const cur = counts.get(k)!;
        cur.votes += b.weight;
        cur.voters += 1;
      }
    }
    const candidates = r.candidates.map((c) => {
      const t = counts.get(c.token.toLowerCase()) ?? { votes: 0, voters: 0 };
      const cleanHeadline =
        typeof c.headline === "string"
          ? c.headline
              .replace(/^DELPHI\s+/i, "")
              .replace(/\bDELPHI\b/g, "The Lens")
              .replace(/\bPANTHEON\b/g, "CANON")
          : undefined;
      return { ...c, headline: cleanHeadline, votes: t.votes, voters: t.voters };
    });
    const sorted = [...candidates].sort((a, b) => b.votes - a.votes || a.rank - b.rank);
    const leaders = sorted.slice(0, r.seats).map((c) => c.token);
    return { candidates, leaders };
  }

  function statusOf(r: RoundVoteFile, nowSec: number): "upcoming" | "open" | "closed" {
    if (nowSec < r.opensAt) return "upcoming";
    if (nowSec < r.closesAt) return "open";
    return "closed";
  }

  async function readStanding(voter: Address): Promise<{ staked: bigint; tier: number; weight: number } | null> {
    try {
      const [staked, tier] = await Promise.all([
        publicClient.readContract({ address: activeDeployment.staking, abi: stakingBalanceAbi, functionName: "balanceOf", args: [voter] }),
        publicClient.readContract({ address: activeDeployment.passportRegistry, abi: passportTierAbi, functionName: "tierOf", args: [voter] }),
      ]);
      const stakeVote = staked > 0n ? 1 : 0;
      const tierNum = Number(tier);
      return { staked, tier: tierNum, weight: stakeVote + tierNum };
    } catch {
      return null;
    }
  }

  let cachedBurned: { value: number | null; at: number } = { value: null, at: 0 };
  async function getBurnedPnth(): Promise<number | null> {
    if (Date.now() - cachedBurned.at < 30_000 && cachedBurned.at > 0) return cachedBurned.value;
    try {
      const raw = await publicClient.readContract({
        address: activeDeployment.pnth,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [activeDeployment.burnSink],
      });
      const val = Number(formatUnits(raw, 18));
      cachedBurned = { value: val, at: Date.now() };
      return val;
    } catch {
      cachedBurned = { value: null, at: Date.now() };
      return null;
    }
  }

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  // Active deployment endpoints (hot-swappable from Testnet Studio)
  app.get("/api/deployment", (_req, res) => {
    res.json({
      customActive,
      deployment: activeDeployment,
      sharedDeployment,
    });
  });

  // Downloadable 3-page Free Testnet Keys & $0 Cost PDF Guide (stamped with active contracts)
  app.get(["/canon-testnet-keys.pdf", "/api/testnet-keys.pdf"], (_req, res) => {
    const pdfBytes = buildTestnetKeysPdf(activeDeployment);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="canon-testnet-keys-guide.pdf"');
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdfBytes));
  });

  app.post("/api/deployment", async (req, res) => {
    const valid = validateDeploymentPayload(req.body);
    if (!valid) {
      return res.status(400).json({ error: "INVALID_DEPLOYMENT" });
    }
    activeDeployment = valid;
    customActive = valid.pnth.toLowerCase() !== sharedDeployment.pnth.toLowerCase();
    cachedBurned = { value: null, at: 0 };
    await fs.writeFile(activeDeploymentAbs, `${JSON.stringify(valid, null, 2)}\n`, "utf8").catch(() => null);
    return res.json({ ok: true, customActive, deployment: activeDeployment });
  });

  app.delete("/api/deployment", async (_req, res) => {
    activeDeployment = sharedDeployment;
    customActive = false;
    cachedBurned = { value: null, at: 0 };
    await fs.unlink(activeDeploymentAbs).catch(() => null);
    return res.json({ ok: true, customActive: false, deployment: activeDeployment });
  });

  // Background worker & live contract status readout
  app.get("/api/workers/status", async (_req, res) => {
    const upstream = (process.env.PASSPORT_API || "").trim();
    let passWorkerOnline = false;
    let passWorkerDetail: Record<string, unknown> | null = null;

    if (upstream) {
      try {
        const r = await fetch(`${upstream.replace(/\/$/, "")}/health`, {
          signal: AbortSignal.timeout(3_500),
        });
        if (r.ok) {
          passWorkerOnline = true;
          passWorkerDetail = (await r.json().catch(() => null)) as Record<string, unknown> | null;
        }
      } catch {
        passWorkerOnline = false;
      }
    }

    try {
      const [routerRuns, activeBasketId, proposalCount, totalStaked, vaultUsdc, attestor, retired] =
        await Promise.all([
          publicClient.readContract({
            address: activeDeployment.pnthRouter,
            abi: workerTelemetryAbi,
            functionName: "runCount",
          }),
          publicClient.readContract({
            address: activeDeployment.constituentRegistry,
            abi: workerTelemetryAbi,
            functionName: "activeId",
          }),
          publicClient.readContract({
            address: activeDeployment.constituentRegistry,
            abi: workerTelemetryAbi,
            functionName: "proposalCount",
          }),
          publicClient.readContract({
            address: activeDeployment.staking,
            abi: workerTelemetryAbi,
            functionName: "totalStaked",
          }),
          publicClient.readContract({
            address: activeDeployment.usdc,
            abi: erc20BalanceAbi,
            functionName: "balanceOf",
            args: [activeDeployment.indexVault],
          }),
          publicClient.readContract({
            address: activeDeployment.passportRegistry,
            abi: workerTelemetryAbi,
            functionName: "ATTESTOR",
          }),
          publicClient.readContract({
            address: activeDeployment.passportRegistry,
            abi: workerTelemetryAbi,
            functionName: "retired",
          }),
        ]);

      return res.json({
        customActive,
        passportWorker: {
          configured: Boolean(upstream),
          online: passWorkerOnline,
          detail: passWorkerDetail,
        },
        chain: {
          routerRuns: Number(routerRuns),
          activeBasketId: Number(activeBasketId),
          proposalCount: Number(proposalCount),
          totalStaked: formatUnits(totalStaked, 18),
          vaultUsdcBudget: formatUnits(vaultUsdc, 6),
          attestor,
          passportRetired: retired,
        },
      });
    } catch {
      return res.json({
        customActive,
        passportWorker: {
          configured: Boolean(upstream),
          online: passWorkerOnline,
          detail: passWorkerDetail,
        },
        chain: null,
      });
    }
  });

  // Live index & chain numbers
  app.get("/api/live", async (_req, res) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const burnedPnth = await getBurnedPnth();
    const flaggedCount = round4.excluded.filter((e) => e.why.startsWith("DELPHI FLAG:")).length;
    const totalChecked = round4.ranking.length + round4.excluded.filter((e) => e.symbol !== "PNTH").length;
    const stakerWallets = round4.vote?.ballots?.length ?? 28;
    const status = statusOf(round5, nowSec);

    res.json({
      people: { wallets: 68, people: 51 },
      stakers: stakerWallets,
      burned:
        burnedPnth !== null && burnedPnth > 0
          ? { pnth: burnedPnth, url: `${EXPLORER}/address/${activeDeployment.burnSink}` }
          : null,
      bought: null,
      basket: {
        coins: round4.symbols.map((symbol, idx) => ({
          token: round4.tokens[idx],
          symbol,
          weightPct: Number((round4.weightsBps[idx] / 100).toFixed(2)),
          bought: 0,
          flagged: false,
          leaving: false,
        })),
      },
      next: null,
      vote: {
        round: round5.round,
        open: status === "open",
        closesAt: round5.closesAt,
        ballots: status === "upcoming" ? (round4.vote?.ballots?.length ?? 0) : round5Ballots.size,
      },
      checked: {
        coins: totalChecked,
        flagged: flaggedCount,
      },
    });
  });

  // Lens coin check index
  app.get("/api/delphi", (_req, res) => {
    res.json(delphiSnapshot);
  });

  // Ballot API (/api/trials/current, /api/trials/vote, /api/trials/rounds/:n)
  app.get("/api/trials/current", async (req, res) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const all = [...round5Ballots.values()];
    const { candidates, leaders } = tallyRound(round5, all);
    const base = {
      round: round5.round,
      status: statusOf(round5, nowSec),
      opensAt: round5.opensAt,
      closesAt: round5.closesAt,
      seats: round5.seats,
      method: round5.method,
      source: round5.source,
      candidates,
      leaders,
      ballots: all.length,
    };

    const voterParam = typeof req.query.voter === "string" ? req.query.voter : undefined;
    if (!voterParam) return res.json(base);
    if (!isAddress(voterParam, { strict: false })) return res.status(400).json({ error: "INVALID_ADDRESS" });

    const voter = getAddress(voterParam);
    const standing = await readStanding(voter);
    const ballot = round5Ballots.get(voter.toLowerCase()) ?? null;
    return res.json({
      ...base,
      you: {
        voter,
        weight: standing ? standing.weight : null,
        staked: standing ? standing.staked.toString() : null,
        tier: standing ? standing.tier : null,
        ballot,
      },
    });
  });

  app.get("/api/trials/rounds/:n", async (req, res) => {
    const n = Number(req.params.n);
    if (n === round5.round) {
      const nowSec = Math.floor(Date.now() / 1000);
      const all = [...round5Ballots.values()];
      const { candidates, leaders } = tallyRound(round5, all);
      return res.json({
        round: round5.round,
        status: statusOf(round5, nowSec),
        opensAt: round5.opensAt,
        closesAt: round5.closesAt,
        seats: round5.seats,
        method: round5.method,
        source: round5.source,
        candidates,
        leaders,
        ballots: all.length,
        ballotList: all,
      });
    }
    try {
      const file = await readJson<Record<string, unknown>>(`src/data/deployments/trials/round-${n}.json`);
      return res.json(file);
    } catch {
      return res.status(404).json({ error: "NO_ROUND" });
    }
  });

  app.post("/api/trials/vote", async (req, res) => {
    const { round, voter, coins, signedAt, signature } = req.body ?? {};
    if (
      round !== round5.round ||
      typeof voter !== "string" ||
      !isAddress(voter, { strict: false }) ||
      !Array.isArray(coins) ||
      coins.length === 0 ||
      coins.length > round5.seats ||
      typeof signedAt !== "number" ||
      typeof signature !== "string"
    ) {
      return res.status(400).json({ error: "INVALID_BALLOT" });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const currentStatus = statusOf(round5, nowSec);
    if (currentStatus === "upcoming") return res.status(400).json({ error: "NOT_OPEN" });
    if (currentStatus === "closed") return res.status(400).json({ error: "CLOSED" });

    const voterAddr = getAddress(voter);
    const validCandidates = new Set(round5.candidates.map((c) => c.token.toLowerCase()));
    const normalizedCoins: Hex[] = [];
    for (const c of coins) {
      if (typeof c !== "string" || !isAddress(c, { strict: false }) || !validCandidates.has(c.toLowerCase())) {
        return res.status(400).json({ error: "NOT_A_CANDIDATE" });
      }
      normalizedCoins.push(getAddress(c) as Hex);
    }

    const ok = await verifyBallotSignature({
      voterAddr,
      chainId: round5.chainId,
      round,
      coins: normalizedCoins,
      signedAt,
      signature: signature as Hex,
    });
    if (!ok) return res.status(400).json({ error: "BAD_SIGNATURE" });

    const standing = await readStanding(voterAddr);
    if (!standing) return res.status(503).json({ error: "CHAIN_UNAVAILABLE" });
    if (standing.weight < 1) return res.status(403).json({ error: "NO_VOTES" });

    const existing = round5Ballots.get(voterAddr.toLowerCase());
    if (existing && existing.signedAt >= signedAt) {
      return res.status(409).json({ error: "OLDER_BALLOT" });
    }

    const ballot: Ballot = {
      voter: voterAddr,
      coins: normalizedCoins,
      weight: standing.weight,
      staked: standing.staked.toString(),
      tier: standing.tier,
      signedAt,
      signature: signature as Hex,
      receivedAt: nowSec,
    };
    round5Ballots.set(voterAddr.toLowerCase(), ballot);
    return res.json({ ok: true, result: existing ? "updated" : "recorded", ballot });
  });

  // Lens dispute submission
  app.post("/api/delphi/v1/dispute", (req, res) => {
    const { token, message, contact } = req.body ?? {};
    if (typeof token !== "string" || !isAddress(token, { strict: false }) || typeof message !== "string" || message.trim().length < 10) {
      return res.status(400).json({ error: "Please include a valid coin address and at least one clear sentence explaining what happened." });
    }
    disputes.push({
      token: getAddress(token),
      message: message.trim().slice(0, 1200),
      contact: typeof contact === "string" ? contact.trim().slice(0, 200) : undefined,
      at: new Date().toISOString(),
    });
    return res.json({ ok: true, count: disputes.length });
  });

  // Upstream HYPE Pass proxy
  app.use("/api/passport", async (req, res) => {
    const upstream = process.env.PASSPORT_API;
    if (!upstream) {
      return res.status(503).json({ error: "HTTP_503" });
    }
    try {
      const targetUrl = `${upstream.replace(/\/$/, "")}/passport${req.url}`;
      const r = await fetch(targetUrl, {
        method: req.method,
        headers: { "content-type": "application/json" },
        body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
        signal: AbortSignal.timeout(8_000),
      });
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json(data);
    } catch {
      return res.status(503).json({ error: "HTTP_503" });
    }
  });

  const yoyoDir =
    process.env.NODE_ENV !== "production"
      ? path.join(__dirname, "public", "yoyo")
      : path.join(__dirname, "dist", "yoyo");

  app.use(
    "/yoyo",
    express.static(yoyoDir, {
      maxAge: "7d",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".avif")) {
          res.setHeader("Content-Type", "image/avif");
        } else if (filePath.endsWith(".webp")) {
          res.setHeader("Content-Type", "image/webp");
        }
        res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
      },
    })
  );

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CANON server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
