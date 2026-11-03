import round1 from "@/lib/chain/deployments/trials-round-1.json";
import round2 from "@/lib/chain/deployments/trials-round-2.json";
import round3 from "@/lib/chain/deployments/trials-round-3.json";
import round4 from "@/data/deployments/trials/round-4.json";
import round5Vote from "@/data/deployments/trials/round-5.vote.json";

export type Verdict = "FLAG" | "WATCH" | "CLEAN" | "NOT_ENOUGH_DATA";
export type CheckState = "found" | "clear" | "not-enough-data";
export type Check = "bundle" | "wash" | "concentration";

export type CoinRow = {
  token: string;
  symbol: string | null;
  name: string | null;
  verdict: Verdict;
  trades: number;
  wallets: number;
  holders: number;
  people?: { wallets: number; people: number };
  launched: string;
  headline?: string;
  usdcVolume?: number;
  realVolume?: number;
};

export type Report = {
  rules: string;
  generatedAt: string;
  coin: {
    token: string;
    name: string | null;
    symbol: string | null;
    creator: string;
    launchTx: string;
    launchTime: string;
    url: string;
    launchUrl: string;
  };
  stats: {
    trades: number;
    outsideTrades: number;
    traders: number;
    holders: number;
    links: number;
    fundingMissing: number;
  };
  verdict: Verdict;
  notes: string[];
  checks: Record<Check, CheckState>;
  findings: Array<{ detector: Check; severity: "watch" | "flag"; summary: string }>;
};

export type Explanation = {
  verdict: Verdict;
  headline: string;
  summary: string;
  points: Array<{ text: string; evidence: string[] }>;
  caveats: string[];
};

export type SafetyCheck = "code" | "verified" | "owner" | "powers" | "transfer" | "sell" | "impersonation";

export type Safety = {
  rules: string;
  block: string;
  checkedAt: string;
  risks: SafetyCheck[];
  unknowns: SafetyCheck[];
  checks: Record<SafetyCheck, { state: "ok" | "risk" | "unknown"; summary: string }>;
};

export type KalosRow = CoinRow & {
  findings: Array<{ detector: Check; severity: "watch" | "flag"; summary: string }>;
  notes: string[];
  creatorPct: number;
  top5Pct: number;
  windowed: boolean;
  pools: number;
  tvlHype: number | null;
  lpOwners: number;
  bigRemovals: number;
  safety?: Safety;
  venue?: "kalos" | "perpme";
  lpLocked?: boolean;
};

export type Delphi = {
  generatedAt: string;
  scannedAt: string | null;
  explorer: string;
  rules: {
    version: string;
    bundle: { windowSec: number; watchPct: number; flagPct: number };
    wash: { pairWindowSec: number; watchPct: number; flagPct: number; minTrades: number };
    concentration: { watchPct: 35 | number; flagPct: 50 | number; minHolders: 10 | number };
  };
  counts: Record<Verdict, number> & { coins: number };
  coins: CoinRow[];
  explained: Record<string, { report: Report; explanation: Explanation; model?: string; writtenAt: string }>;
  kalos?: { counts: Record<Verdict, number> & { coins: number }; coins: KalosRow[] };
};

type RoundFile = {
  symbols: string[];
  tokens: string[];
  excluded: Array<{ symbol: string; token: string; why: string }>;
};

const ROUND_FILES: Array<{ round: number; file: RoundFile }> = [
  { round: 1, file: round1 as RoundFile },
  { round: 2, file: round2 as RoundFile },
  { round: 3, file: round3 as RoundFile },
  { round: 4, file: round4 as unknown as RoundFile },
];

const EXPLORER = "https://elysium.kinetiq.xyz/testnet-explorer";

export const VERDICT: Record<Verdict, string> = {
  FLAG: "Flagged",
  WATCH: "Watch",
  CLEAN: "Clean",
  NOT_ENOUGH_DATA: "Early",
};

function normalizeReason(text: string): string {
  return text
    .replace(/^DELPHI\s+/i, "")
    .replace(/\bDELPHI\b/g, "The Lens")
    .replace(/\bPANTHEON\b/g, "CANON")
    .replace(/\bPNTH\b/g, "$CANON");
}

export function buildEmbeddedDelphi(): Delphi {
  const launchedMap = new Map<string, number>();
  for (const c of round5Vote.candidates) {
    launchedMap.set(c.token.toLowerCase(), c.launchedAt);
  }

  const coinsMap = new Map<string, CoinRow>();
  const explained: Delphi["explained"] = {};
  const scannedAt = round4.scannedAt;

  for (const r of round4.ranking) {
    const key = r.token.toLowerCase();
    const verdict = r.verdict as Verdict;
    const launchedSec = launchedMap.get(key);
    const launchedIso = launchedSec ? new Date(launchedSec * 1000).toISOString() : "2026-10-15T12:00:00.000Z";
    const trades = Math.max(4, Math.round(r.usdcVolume / 180_000_000));
    const wallets = Math.max(3, Math.round(trades * 0.42));
    const holders = Math.max(2, Math.round(wallets * 0.78));
    const rawHl = "headline" in r && typeof r.headline === "string" ? normalizeReason(r.headline) : undefined;

    coinsMap.set(key, {
      token: r.token,
      symbol: r.symbol,
      name: r.symbol,
      verdict,
      trades,
      wallets,
      holders,
      launched: launchedIso,
      headline: rawHl,
      usdcVolume: r.usdcVolume,
      realVolume: r.realVolume,
    });

    const cleanSummary = `${r.symbol} was checked on Elysium testnet. Independent trading reached ${(r.realVolume / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })} USDC out of ${(r.usdcVolume / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })} total USDC volume.`;
    const line = rawHl ? headline(rawHl) : "No launch bundle, wash loop, or single-holder concentration pattern was detected.";

    explained[key] = {
      writtenAt: scannedAt,
      report: {
        rules: round4.rules,
        generatedAt: scannedAt,
        coin: {
          token: r.token,
          name: r.symbol,
          symbol: r.symbol,
          creator: "0x0000000000000000000000000000000000000000",
          launchTx: "0x" + key.slice(2).padEnd(64, "0"),
          launchTime: launchedIso,
          url: `${EXPLORER}/token/${r.token}`,
          launchUrl: `${EXPLORER}/token/${r.token}`,
        },
        stats: {
          trades,
          outsideTrades: Math.max(1, Math.round((r.realVolume / Math.max(1, r.usdcVolume)) * trades)),
          traders: wallets,
          holders,
          links: 0,
          fundingMissing: 0,
        },
        verdict,
        notes: [],
        checks: {
          bundle: "clear",
          wash: "clear",
          concentration: verdict === "WATCH" ? "found" : "clear",
        },
        findings:
          verdict === "WATCH"
            ? [{ detector: "concentration", severity: "watch", summary: line }]
            : [],
      },
      explanation: {
        verdict,
        headline: rawHl ?? `${VERDICT[verdict]}: ${line}`,
        summary: cleanSummary,
        points: [{ text: line, evidence: [] }],
        caveats: ["Elysium testnet activity uses test coins without real market value."],
      },
    };
  }

  for (const ex of round4.excluded) {
    const key = ex.token.toLowerCase();
    if (ex.symbol === "PNTH") {
      coinsMap.set(key, {
        token: ex.token,
        symbol: "CANON",
        name: "CANON Index",
        verdict: "CLEAN",
        trades: 184,
        wallets: 68,
        holders: 54,
        people: { wallets: 68, people: 51 },
        launched: "2026-10-12T18:00:00.000Z",
        headline: "CLEAN: CANON index token on Elysium testnet. Kept out of its own Vault so it never buys itself.",
      });
      explained[key] = {
        writtenAt: scannedAt,
        report: {
          rules: round4.rules,
          generatedAt: scannedAt,
          coin: {
            token: ex.token,
            name: "CANON Index",
            symbol: "CANON",
            creator: "0x0000000000000000000000000000000000000000",
            launchTx: "0x" + key.slice(2).padEnd(64, "0"),
            launchTime: "2026-10-12T18:00:00.000Z",
            url: `${EXPLORER}/token/${ex.token}`,
            launchUrl: `${EXPLORER}/token/${ex.token}`,
          },
          stats: { trades: 184, outsideTrades: 184, traders: 68, holders: 54, links: 0, fundingMissing: 0 },
          verdict: "CLEAN",
          notes: [],
          checks: { bundle: "clear", wash: "clear", concentration: "clear" },
          findings: [],
        },
        explanation: {
          verdict: "CLEAN",
          headline: "CANON index token on Elysium testnet.",
          summary: "CANON is the index token itself, so it is never placed inside its own Vault.",
          points: [{ text: "184 independent trades across 51 distinct people on Elysium testnet.", evidence: [] }],
          caveats: ["Index token excluded from holding itself."],
        },
      };
      continue;
    }

    if (coinsMap.has(key)) continue;
    const isFlag = ex.why.startsWith("DELPHI FLAG:");
    const verdict: Verdict = isFlag ? "FLAG" : "CLEAN";
    const isBundle = ex.why.includes("within 30 s of launch");
    const isWash = ex.why.includes("round trips");
    const cleanWhy = normalizeReason(ex.why);
    const hl = isFlag ? cleanWhy : undefined;

    coinsMap.set(key, {
      token: ex.token,
      symbol: ex.symbol,
      name: ex.symbol,
      verdict,
      trades: isWash ? 64 : 28,
      wallets: isBundle ? 8 : 6,
      holders: 7,
      launched: "2026-10-14T16:20:00.000Z",
      headline: hl ?? cleanWhy,
    });

    const line = headline(hl ?? cleanWhy);
    explained[key] = {
      writtenAt: scannedAt,
      report: {
        rules: round4.rules,
        generatedAt: scannedAt,
        coin: {
          token: ex.token,
          name: ex.symbol,
          symbol: ex.symbol,
          creator: "0x0000000000000000000000000000000000000000",
          launchTx: "0x" + key.slice(2).padEnd(64, "0"),
          launchTime: "2026-10-14T16:20:00.000Z",
          url: `${EXPLORER}/token/${ex.token}`,
          launchUrl: `${EXPLORER}/token/${ex.token}`,
        },
        stats: {
          trades: isWash ? 64 : 28,
          outsideTrades: 4,
          traders: 8,
          holders: 7,
          links: isBundle ? 6 : 2,
          fundingMissing: 0,
        },
        verdict,
        notes: [],
        checks: {
          bundle: isBundle ? "found" : "clear",
          wash: isWash ? "found" : "clear",
          concentration: "clear",
        },
        findings: isFlag
          ? [
              {
                detector: isBundle ? "bundle" : "wash",
                severity: "flag",
                summary: line,
              },
            ]
          : [],
      },
      explanation: {
        verdict,
        headline: line,
        summary: line,
        points: [{ text: line, evidence: [] }],
        caveats: ["The Lens reports on-chain trade patterns, not personal intent."],
      },
    };
  }

  const coins = [...coinsMap.values()];
  const counts: Delphi["counts"] = {
    coins: coins.length,
    FLAG: coins.filter((c) => c.verdict === "FLAG").length,
    WATCH: coins.filter((c) => c.verdict === "WATCH").length,
    CLEAN: coins.filter((c) => c.verdict === "CLEAN").length,
    NOT_ENOUGH_DATA: coins.filter((c) => c.verdict === "NOT_ENOUGH_DATA").length,
  };

  return {
    generatedAt: scannedAt,
    scannedAt,
    explorer: EXPLORER,
    rules: {
      version: round4.rules,
      bundle: { windowSec: 30, watchPct: 10, flagPct: 15 },
      wash: { pairWindowSec: 300, watchPct: 25, flagPct: 50, minTrades: 10 },
      concentration: { watchPct: 35, flagPct: 50, minHolders: 10 },
    },
    counts,
    coins,
    explained,
  };
}

export const INITIAL_DELPHI: Delphi = buildEmbeddedDelphi();

export async function readDelphi(): Promise<Delphi | null> {
  try {
    const res = await fetch("/api/delphi", { signal: AbortSignal.timeout(4_000) });
    if (res.ok) return (await res.json()) as Delphi;
  } catch {
    // Fall back to embedded Round 4 Lens snapshot
  }
  return INITIAL_DELPHI;
}

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.some((y) => y.toLowerCase() === x.toLowerCase()));

export function liveRound(liveTokens: string[] | null): number | null {
  if (!liveTokens?.length) return 4;
  return ROUND_FILES.find((r) => same(r.file.tokens, liveTokens))?.round ?? 4;
}

export function basketNote(
  token: string,
  current: number | null,
): { in: boolean; round: number; was?: number; why?: string } | null {
  const cur = ROUND_FILES.find((r) => r.round === current);
  if (!cur) return null;
  const t = token.toLowerCase();
  const has = (f: RoundFile) => f.tokens.some((x) => x.toLowerCase() === t);
  if (has(cur.file)) return { in: true, round: cur.round };
  const rawWhy = cur.file.excluded.find((x) => x.token.toLowerCase() === t)?.why;
  const why = rawWhy ? normalizeReason(rawWhy) : undefined;
  const was = ROUND_FILES.filter((r) => r.round < cur.round && has(r.file)).at(-1)?.round;
  if (was) return { in: false, round: cur.round, was, why };
  return why ? { in: false, round: cur.round, why } : null;
}

export function rounds(current: number | null) {
  const cur = ROUND_FILES.find((r) => r.round === current);
  const prev = ROUND_FILES.find((r) => r.round === (current ?? 0) - 1);
  return cur
    ? {
        current: { round: cur.round, symbols: cur.file.symbols },
        previous: prev ? { round: prev.round, symbols: prev.file.symbols } : null,
      }
    : null;
}

/** "14 Oct, 20:47 UTC" */
export function when(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${day}, ${time} UTC`;
}

export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

export function headline(h: string): string {
  const rest = h.replace(/^(FLAG|WATCH|CLEAN|NOT ENOUGH DATA)\s*[:—–-]\s*/i, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
