import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useSignTypedData } from "wagmi";
import { ArrowUpRight, Check } from "lucide-react";
import { elysium } from "@/lib/chain/config";
import { CodeScramble, ContractRibbon } from "./code-art";
import { until, useNow, type Hex, type TabKey } from "./shared";

type CandidateVerdict = "CLEAN" | "WATCH" | "NOT_ENOUGH_DATA";

type CandidateCoin = {
  token: Hex;
  symbol: string | null;
  verdict: CandidateVerdict;
  headline?: string;
  realUsdc: string;
  rank: number;
  votes: number;
  voters: number;
};

type SavedBallot = {
  voter: Hex;
  coins: Hex[];
  weight: number;
  tier: number;
  signedAt: number;
};

type BallotSnapshot = {
  round: number;
  status: "upcoming" | "open" | "closed";
  opensAt: number;
  closesAt: number;
  seats: number;
  candidates: CandidateCoin[];
  leaders: Hex[];
  ballots: number;
  you?: {
    voter: Hex;
    weight: number | null;
    tier: number | null;
    ballot: SavedBallot | null;
  };
};

const BALLOT_DOMAIN = {
  name: "CANON Ballot",
  version: "1",
  chainId: elysium.id,
} as const;

const BALLOT_TYPES = {
  Ballot: [
    { name: "round", type: "uint256" },
    { name: "voter", type: "address" },
    { name: "coins", type: "address[]" },
    { name: "signedAt", type: "uint64" },
  ],
} as const;

const VOTE_ERRORS: Record<string, string> = {
  NO_VOTES: "This wallet has no staked $CANON or HYPE Pass yet. Stake any amount of $CANON first, then sign.",
  BAD_SIGNATURE: "Signature did not match this wallet. Try signing again.",
  CLOSED: "This ballot round has closed.",
  NOT_OPEN: "This ballot round has not opened yet.",
  NOT_A_CANDIDATE: "One of the selected coins is not part of this round.",
  OLDER_BALLOT: "A newer ballot is already saved for this wallet.",
  CHAIN_UNAVAILABLE: "Could not read your staking balance from Elysium right now. Try again in a moment.",
};

function fmtUsdcRaw(raw: string): string {
  return (Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function VoteView({
  onOpenWallet,
  onOpenPass,
  onInspectCoin,
  onNavigate,
}: {
  onOpenWallet: () => void;
  onOpenPass: () => void;
  onInspectCoin: (token: string) => void;
  onNavigate: (tab: TabKey) => void;
}) {
  const { address, isConnected, chainId } = useConnection();
  const onChain = isConnected && chainId === elysium.id;
  const voter = onChain ? address : undefined;
  const now = useNow();
  const qc = useQueryClient();
  const sign = useSignTypedData();

  const [picked, setPicked] = useState<Hex[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const ballotQuery = useQuery({
    queryKey: ["ballot-current", voter ?? ""],
    refetchInterval: 12_000,
    queryFn: async (): Promise<BallotSnapshot | null> => {
      const res = await fetch(`/api/trials/current${voter ? `?voter=${voter}` : ""}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return (await res.json()) as BallotSnapshot;
    },
  });

  const snap = ballotQuery.data;

  if (ballotQuery.isLoading) {
    return (
      <div className="py-8">
        <p className="ui-label">The Ballot</p>
        <h1 className="heading-section mt-1.5 text-[28px] text-ink">Loading Round 5…</h1>
      </div>
    );
  }

  if (ballotQuery.error || !snap) {
    return (
      <div className="py-8">
        <p className="ui-label">The Ballot</p>
        <h1 className="heading-section mt-1.5 text-[28px] text-ink">Ballot Unavailable</h1>
        <p className="mt-2 text-[15px] text-stone">
          Could not reach the Ballot service right now. Refresh in a moment.
        </p>
      </div>
    );
  }

  const weight = snap.you?.weight ?? null;
  const tier = snap.you?.tier ?? 0;
  const saved = snap.you?.ballot ?? null;
  const selection = picked ?? saved?.coins ?? [];
  const isPicked = (token: Hex) => selection.some((x) => x.toLowerCase() === token.toLowerCase());

  const togglePick = (token: Hex) => {
    setSent(false);
    setErr(null);
    if (isPicked(token)) {
      setPicked(selection.filter((x) => x.toLowerCase() !== token.toLowerCase()));
    } else if (selection.length < snap.seats) {
      setPicked([...selection, token]);
    }
  };

  const canSign = snap.status === "open" && onChain && (weight ?? 0) > 0;
  const candidates = [...snap.candidates].sort((a, b) => a.rank - b.rank);
  const topVotes = Math.max(1, ...candidates.map((c) => c.votes));
  const leaderSet = new Set(snap.leaders.map((x) => x.toLowerCase()));

  const selectionChanged =
    picked !== null &&
    (picked.length !== (saved?.coins.length ?? 0) ||
      picked.some((c) => !saved?.coins.some((m) => m.toLowerCase() === c.toLowerCase())));

  const submitBallot = async () => {
    if (!address || selection.length === 0) return;
    setErr(null);
    setBusy("Waiting for wallet signature…");
    try {
      const signedAt = Math.floor(Date.now() / 1000);
      const signature = await sign.mutateAsync({
        domain: BALLOT_DOMAIN,
        types: BALLOT_TYPES,
        primaryType: "Ballot",
        message: {
          round: BigInt(snap.round),
          voter: address,
          coins: selection,
          signedAt: BigInt(signedAt),
        },
      } as Parameters<typeof sign.mutateAsync>[0]);

      setBusy("Recording your ballot…");
      const res = await fetch("/api/trials/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          round: snap.round,
          voter: address,
          coins: selection,
          signedAt,
          signature,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP_${res.status}`);
      setPicked(null);
      setSent(true);
      await qc.invalidateQueries({ queryKey: ["ballot-current"] });
    } catch (e) {
      const raw = String((e as Error).message ?? e);
      setErr(
        /rejected|denied/i.test(raw)
          ? "You cancelled the signature in your wallet."
          : VOTE_ERRORS[raw] ?? raw.split("\n")[0],
      );
    } finally {
      setBusy(null);
    }
  };

  const clockLabel =
    snap.status === "upcoming"
      ? `Opens in ${until(snap.opensAt - now)}`
      : snap.status === "open"
        ? `Closes in ${until(snap.closesAt - now)}`
        : "Round Closed";

  const buttonText = !onChain
    ? "Connect Wallet to Vote"
    : snap.status === "upcoming"
      ? `Ballot Opens in ${until(snap.opensAt - now)}`
      : snap.status === "closed"
        ? "Round Closed"
        : weight === null
          ? "Reading Your Stake…"
          : weight === 0
            ? "Stake $CANON to Unlock Voting"
            : selection.length === 0
              ? `Pick Up to ${snap.seats} Coins`
              : saved && !selectionChanged
                ? "Ballot Recorded ✓"
                : saved
                  ? "Sign Updated Ballot (Free)"
                  : "Sign Ballot (Free Signature)";

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="ui-label">
            The Ballot · Round {snap.round} · {clockLabel}
          </p>
          <h1 className="heading-section mt-1.5 text-[32px] text-ink sm:text-[38px]">
            Choose 3 Vault Seats
          </h1>
          <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-stone">
            Pick up to {snap.seats} clean coins with a free wallet signature. Top vote-getters claim {snap.seats} seats in the next Vault list.
          </p>
        </div>
        <p className="num text-[13px] font-semibold text-stone">
          <CodeScramble value={`${snap.ballots}`} /> {snap.ballots === 1 ? "ballot" : "ballots"} cast
        </p>
      </div>

      <ContractRibbon highlight={`signTypedData(Ballot#${snap.round})`} />

      {/* Minimalist Voter Standing Bar */}
      <section className="flex flex-col justify-between gap-3 pb-6 sm:flex-row sm:items-center">
        {!onChain ? (
          <>
            <div>
              <p className="heading-card text-[17px] text-ink">Check your voting weight</p>
              <p className="mt-0.5 text-[13.5px] text-stone">
                Connect the wallet you stake $CANON or hold your HYPE Pass with.
              </p>
            </div>
            <button type="button" onClick={onOpenWallet} className="btn-primary shrink-0">
              Connect Wallet
            </button>
          </>
        ) : weight === 0 ? (
          <>
            <div>
              <p className="heading-card text-[17px] text-ink">0 Votes on This Wallet</p>
              <p className="mt-0.5 text-[13.5px] text-stone">
                Stake any amount of $CANON for 1 vote, or link a HYPE Pass for +1 to +3 extra votes.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate("earn")}
                className="btn-signal min-h-[42px] px-4 text-[13.5px]"
              >
                Stake $CANON
              </button>
              <button
                type="button"
                onClick={onOpenPass}
                className="btn-secondary min-h-[42px] px-4 text-[13.5px]"
              >
                HYPE Pass
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <p className="heading-card text-[17px] text-ink">
                Your Ballot Weight:{" "}
                <span className="num text-forest">
                  {weight ?? "—"} {weight === 1 ? "vote" : "votes"} per pick
                </span>
              </p>
              <p className="mt-0.5 text-[13px] text-stone">
                {tier > 0
                  ? `Includes Tier ${tier} HYPE Pass (+${tier}).`
                  : "Link a HYPE Pass to add up to +3 extra votes."}
                {saved && !selectionChanged && " Your signed ballot is recorded."}
              </p>
            </div>
            {tier === 0 && (
              <button
                type="button"
                onClick={onOpenPass}
                className="btn-secondary min-h-[40px] shrink-0 px-4 text-[13px]"
              >
                Add HYPE Votes
              </button>
            )}
          </>
        )}
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
        <section className="canon-card p-5 sm:p-6 lg:col-span-8">
          <div className="flex items-center justify-between pb-3.5">
            <p className="ui-label">{candidates.length} Eligible Clean Coins</p>
            <span className="num text-[12.5px] font-bold text-ink">
              {selection.length} / {snap.seats} Picked
            </span>
          </div>

          <ul className="mt-3 space-y-1">
            {candidates.map((c) => {
              const checked = isPicked(c.token);
              const isLeader = leaderSet.has(c.token.toLowerCase()) && c.votes > 0;
              const disabledRow =
                snap.status === "open" && onChain && (weight ?? 0) > 0
                  ? !checked && selection.length >= snap.seats
                  : false;

              return (
                <li key={c.token} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      disabled={disabledRow}
                      onClick={() => togglePick(c.token)}
                      className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span
                        className={`flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-[7px] transition-colors ${
                          checked
                            ? "bg-signal text-signal-ink"
                            : "bg-well text-stone"
                        }`}
                      >
                        {checked && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-[15.5px] font-extrabold tracking-tight text-ink">
                            {c.symbol ?? `${c.token.slice(0, 6)}…`}
                          </span>
                          <span className="num text-[12px] text-stone">
                            · {fmtUsdcRaw(c.realUsdc)} USDC
                            {isLeader ? " · Leading" : ""}
                          </span>
                        </div>
                        <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-well">
                          <div
                            className="h-full bg-signal transition-all duration-300"
                            style={{ width: `${c.votes > 0 ? Math.max(6, (c.votes / topVotes) * 100) : 0}%` }}
                          />
                        </div>
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className="num text-[13.5px] font-bold text-ink">
                        {c.votes}v
                      </span>
                      <button
                        type="button"
                        onClick={() => onInspectCoin(c.token)}
                        className="btn-secondary min-h-[34px] px-3 text-[12px]"
                      >
                        Proof
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-5">
            {!onChain ? (
              <button type="button" onClick={onOpenWallet} className="btn-primary w-full">
                Connect Wallet to Vote
              </button>
            ) : weight === 0 ? (
              <button type="button" onClick={() => onNavigate("earn")} className="btn-primary w-full">
                Stake $CANON to Unlock Voting
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  !canSign ||
                  selection.length === 0 ||
                  !!busy ||
                  (!!saved && !selectionChanged)
                }
                onClick={submitBallot}
                className="code-glitch btn-signal w-full"
              >
                {busy ?? buttonText}
              </button>
            )}
          </div>

          {err && (
            <p className="mt-3 pt-3 text-[13px] text-crimson">{err}</p>
          )}
          {sent && !err && (
            <p className="mt-3 pt-3 text-[13px] font-bold text-forest">
              Ballot counted. You can update your picks anytime before the round closes.
            </p>
          )}
        </section>

        <aside className="space-y-7 lg:col-span-4">
          <div>
            <p className="ui-label">Leading Seats</p>
            {snap.leaders.length === 0 ? (
              <p className="mt-3 text-[14px] text-stone">No ballots cast in this round yet.</p>
            ) : (
              <ol className="mt-3 space-y-1">
                {snap.leaders.map((addr, idx) => {
                  const found = snap.candidates.find(
                    (c) => c.token.toLowerCase() === addr.toLowerCase(),
                  );
                  return (
                    <li key={addr} className="flex items-center justify-between py-2.5 text-[14px]">
                      <span className="font-bold text-ink">
                        {idx + 1}. {found?.symbol ?? `${addr.slice(0, 6)}…`}
                      </span>
                      <span className="num font-semibold text-stone">
                        {found?.votes ?? 0} {found?.votes === 1 ? "vote" : "votes"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="space-y-2.5 text-[13px] leading-relaxed text-stone">
            <p className="ui-label">Rules</p>
            <p>
              <strong className="font-bold text-ink">Free signature:</strong> Voting signs an EIP-712 message and costs zero gas.
            </p>
            <p>
              <strong className="font-bold text-ink">24-hour timelock:</strong> Closed lists wait 24 hours on-chain before going live.
            </p>
            <a
              href={`/api/trials/rounds/${snap.round}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 pt-1 font-bold text-ink underline underline-offset-2"
            >
              Public ballot JSON
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
