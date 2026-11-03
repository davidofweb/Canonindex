import round4 from "@/data/deployments/trials/round-4.json";
import round5Vote from "@/data/deployments/trials/round-5.vote.json";
import { INITIAL_DELPHI } from "@/lib/delphi";

export type Live = {
  people: { wallets: number; people: number } | null;
  stakers: number | null;
  burned: { pnth: number; url: string | null } | null;
  bought: { usdc: number; buys: number; last: { symbol: string; url: string } | null } | null;
  /** flagged: DELPHI flags it now; leaving: the next list leaves it out. */
  basket: { coins: Array<{ token: string; symbol: string; weightPct: number; bought: number; flagged: boolean; leaving: boolean }> } | null;
  next: { symbols: string[]; startsAt: number } | null;
  vote: { round: number; open: boolean; closesAt: number; ballots: number } | null;
  checked: { coins: number; flagged: number } | null;
};

function buildInitialLive(): Live {
  const nowSec = Math.floor(Date.now() / 1000);
  const open = nowSec >= round5Vote.opensAt && nowSec < round5Vote.closesAt;
  return {
    people: { wallets: 68, people: 51 },
    stakers: round4.vote?.ballots?.length ?? 28,
    burned: null,
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
      round: round5Vote.round,
      open,
      closesAt: round5Vote.closesAt,
      ballots: round4.vote?.ballots?.length ?? 0,
    },
    checked: {
      coins: INITIAL_DELPHI.counts.coins,
      flagged: INITIAL_DELPHI.counts.FLAG,
    },
  };
}

export const INITIAL_LIVE: Live = buildInitialLive();

export async function readLive(): Promise<Live> {
  try {
    const res = await fetch("/api/live", { signal: AbortSignal.timeout(4_500) });
    if (res.ok) return (await res.json()) as Live;
  } catch {
    // Use embedded round snapshot if offline
  }
  return INITIAL_LIVE;
}
