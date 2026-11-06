import { useState } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { explorer } from "@/lib/chain/config";
import type { Live } from "@/lib/live";
import {
  AmbientCodeRain,
  CodeScramble,
  ContractRibbon,
  MagneticCodeCore,
  RadialCodeVault,
  type VaultSlice,
} from "./code-art";
import { SegmentedControl, type TabKey } from "./shared";
import { YoyoLiquidCapsule } from "./yoyo-eye";

const HERO_RAIN_MASK =
  "radial-gradient(ellipse 62% 46% at 50% 30%, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.42) 44%, #000 94%), linear-gradient(to bottom, #000 0%, #000 68%, transparent 98%)";

type SimMode = "buy" | "sell" | "rules";

const SIM_DETAILS: Record<
  SimMode,
  {
    headline: string;
    sub: string;
    coreMode: "buy" | "sell" | "both";
    ribbon: string;
    rows: Array<{ label: string; value: string; accent?: "signal" | "forest" }>;
  }
> = {
  buy: {
    headline: "Spend 100 USDC to buy $CANON",
    sub: "99.00 USDC buys $CANON in Ascend’s pool. The 1.00 USDC trade fee splits in the same block:",
    coreMode: "buy",
    ribbon: "vault.buyTopTen(0.425_USDC)",
    rows: [
      { label: "Ascend exchange fee", value: "0.500 USDC" },
      { label: "Buys top 10 Vault coins for stakers", value: "0.425 USDC", accent: "forest" },
      { label: "Keeper & scan operations", value: "0.075 USDC" },
    ],
  },
  sell: {
    headline: "Sell 10,000 $CANON back to the pool",
    sub: "9,900 $CANON swaps cleanly for USDC. The 100 $CANON trade fee shrinks total supply on the spot:",
    coreMode: "sell",
    ribbon: "burnSink.burn(42.5_CANON)",
    rows: [
      { label: "Ascend exchange fee", value: "50 $CANON" },
      { label: "Burned forever at dead sink", value: "42.5 $CANON", accent: "signal" },
      { label: "Keeper & scan operations", value: "7.5 $CANON" },
    ],
  },
  rules: {
    headline: "Hard-coded rules, zero owner keys",
    sub: "Fee routing lives inside an immutable contract deployed at launch. Nobody can pause exits or redirect Vault coins:",
    coreMode: "both",
    ribbon: "immutable.noOwner()",
    rows: [
      { label: "Admin or upgrade keys", value: "0" },
      { label: "Vault rebalance timelock", value: "24 hours" },
      { label: "Staker unlock cooldown", value: "3 days" },
    ],
  },
};

export function HomeView({
  live,
  onNavigate,
  onInspectCoin,
  onOpenPass,
  onOpenFeeLock,
}: {
  live: Live;
  onNavigate: (tab: TabKey) => void;
  onInspectCoin: (token: string) => void;
  onOpenPass: () => void;
  onOpenFeeLock: () => void;
}) {
  const [simMode, setSimMode] = useState<SimMode>("buy");
  const [selectedVaultIdx, setSelectedVaultIdx] = useState(0);
  const [previewBallotSwap, setPreviewBallotSwap] = useState(false);

  const baseCoins = live.basket?.coins ?? [];
  const vaultSlices: VaultSlice[] = baseCoins.map((c, idx) => {
    if (previewBallotSwap && idx >= 7) {
      const votedNames = ["GLOW", "KNTQ", "SOLR"];
      return {
        token: c.token,
        symbol: votedNames[idx - 7] ?? c.symbol,
        weightPct: c.weightPct,
        votedSeat: true,
      };
    }
    return {
      token: c.token,
      symbol: c.symbol,
      weightPct: c.weightPct,
      votedSeat: false,
    };
  });

  const activeCoin = baseCoins[selectedVaultIdx] ?? baseCoins[0];
  const sim = SIM_DETAILS[simMode];

  return (
    <div className="space-y-12 lg:space-y-16">
      {/* 1. HERO: Theme-Reactive Falling Code Rain + Thick Geometric Display Typography + 3D Code Sphere */}
      <section className="relative overflow-hidden pb-4 pt-4 sm:pt-8 lg:pt-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <AmbientCodeRain
            className="absolute inset-0"
            style={{
              maskImage: HERO_RAIN_MASK,
              WebkitMaskImage: HERO_RAIN_MASK,
              maskComposite: "intersect",
              WebkitMaskComposite: "source-in",
            }}
          />
        </div>

        <div className="relative mx-auto flex flex-col items-center text-center">
          <div className="mb-5">
            <YoyoLiquidCapsule
              size="stage"
              posture="idle"
              ariaLabel="Tap YOYO to open full-screen Liquid Glass view"
            />
          </div>
          <p className="ui-label mb-4 text-signal">Liquid Index · Elysium Testnet</p>

          <h1 className="heading-hero max-w-[15ch] text-balance text-[42px] text-ink sm:text-[58px] lg:text-[68px]">
            Ten clean coins.
            <br />
            <span className="text-stone">One liquid index.</span>
          </h1>

          <p className="mt-6 max-w-[540px] text-[15.5px] leading-[1.6] text-stone sm:text-[16.5px]">
            <strong className="font-bold text-ink">$CANON</strong> holds Ascend’s top 10 clean coins automatically. Buys fill{" "}
            <strong className="font-bold text-ink">The Vault</strong> for stakers; sells burn supply forever.
          </p>

          <div className="mt-7 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
            <button
              type="button"
              onClick={() => onNavigate("trade")}
              className="code-glitch btn-signal w-full sm:w-auto sm:px-7"
            >
              Get $CANON
              <ArrowRight className="h-4 w-4 stroke-[2.5]" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate("earn")}
              className="btn-secondary w-full sm:w-auto sm:px-6"
            >
              Stake &amp; Earn
            </button>
          </div>

          {/* Theme-Synced 3D Code Sphere */}
          <div className="mt-8 w-full max-w-2xl">
            <MagneticCodeCore
              activeMode={sim.coreMode}
              burnedTotal={live.burned?.pnth ?? null}
            />
          </div>
        </div>
      </section>

      {/* 2. ARCHITECTURAL METRICS STRIP */}
      <section className="pt-8">
        <div className="grid grid-cols-2 gap-y-7 gap-x-6 sm:grid-cols-4">
          <div>
            <p className="ui-label">Vault Coins</p>
            <p className="num mt-1.5 text-[28px] font-extrabold tracking-tight text-ink">
              <CodeScramble value={String(baseCoins.length || 10)} />
            </p>
            <p className="mt-0.5 text-[12.5px] text-stone">Round 4 active list</p>
          </div>

          <div>
            <p className="ui-label">Stakers</p>
            <p className="num mt-1.5 text-[28px] font-extrabold tracking-tight text-ink">
              <CodeScramble value={String(live.stakers ?? 28)} />
            </p>
            <p className="mt-0.5 text-[12.5px] text-stone">
              {live.people ? `${live.people.people} people` : "Earning Vault drips"}
            </p>
          </div>

          <div>
            <p className="ui-label">Lens Checks</p>
            <p className="num mt-1.5 text-[28px] font-extrabold tracking-tight text-ink">
              <CodeScramble value={String(live.checked?.coins ?? 31)} />
            </p>
            <p className="mt-0.5 text-[12.5px] text-stone">
              {live.checked?.flagged ?? 4} flagged &amp; excluded
            </p>
          </div>

          <div>
            <p className="ui-label">Supply Burned</p>
            <p className="num mt-1.5 text-[28px] font-extrabold tracking-tight text-signal">
              <CodeScramble
                value={
                  live.burned?.pnth
                    ? Math.round(live.burned.pnth).toLocaleString("en-US")
                    : "0x..dEaD"
                }
              />
            </p>
            {live.burned?.url ? (
              <a
                href={live.burned.url}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] font-bold text-ink hover:underline"
              >
                Burn sink
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            ) : (
              <p className="mt-0.5 text-[12.5px] text-stone">Every sell shrinks supply</p>
            )}
          </div>
        </div>
      </section>

      <ContractRibbon highlight={sim.ribbon} />

      {/* 3. INTERACTIVE FEE SIMULATOR */}
      <section className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-12">
        <div className="lg:col-span-5">
          <p className="ui-label">1% Locked Trade Fee</p>
          <h2 className="heading-section mt-2 text-[28px] text-ink sm:text-[34px]">
            Buys fill The Vault. Sells burn supply.
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-stone">
            Every coin on Ascend charges a 1% trade fee. CANON locks its creator half inside an ownerless contract that only buys top clean coins or burns $CANON.
          </p>
          <div className="mt-5">
            <SegmentedControl<SimMode>
              ariaLabel="Simulate trade fee routing"
              value={simMode}
              onChange={setSimMode}
              options={[
                { id: "buy", label: "Buy $100" },
                { id: "sell", label: "Sell 10,000" },
                { id: "rules", label: "Rules" },
              ]}
            />
          </div>
        </div>

        <div className="canon-card p-5 sm:p-7 lg:col-span-7">
          <p className="heading-card text-[19px] text-ink">
            <CodeScramble value={sim.headline} durationMs={160} />
          </p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-stone">{sim.sub}</p>

          <div className="mt-5 space-y-1">
            {sim.rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-4 py-2.5 text-[14.5px]">
                <span className="font-semibold text-ink-soft">{r.label}</span>
                <span
                  className={`num font-bold ${
                    r.accent === "signal"
                      ? "text-signal"
                      : r.accent === "forest"
                        ? "text-forest"
                        : "text-ink"
                  }`}
                >
                  <CodeScramble value={r.value} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. INTERACTIVE 10-RING CODE VAULT */}
      <section className="pt-10">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="ui-label">The Vault · Round 4 Live Constituents</p>
            <h2 className="heading-section mt-2 text-[28px] text-ink sm:text-[34px]">
              10 clean coins, woven from code
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setPreviewBallotSwap((v) => !v)}
            className={`inline-flex min-h-[42px] shrink-0 cursor-pointer items-center justify-center rounded-[12px] px-4 text-[13px] font-bold transition-colors ${
              previewBallotSwap
                ? "bg-primary-bg text-primary-fg"
                : "bg-surface text-ink hover:bg-well"
            }`}
          >
            {previewBallotSwap ? "Ballot Seats Active ✓" : "Preview 3 Ballot Seats"}
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
          {/* Interactive Code Ring Dial */}
          <div className="lg:col-span-5">
            <RadialCodeVault
              coins={vaultSlices}
              selectedIndex={selectedVaultIdx}
              onSelect={setSelectedVaultIdx}
            />
            {activeCoin && (
              <div className="mt-4 flex items-center justify-between gap-3 pt-3.5">
                <div className="min-w-0">
                  <p className="text-[14px] font-extrabold text-ink">
                    {vaultSlices[selectedVaultIdx]?.symbol ?? activeCoin.symbol} ·{" "}
                    <span className="num text-signal">{activeCoin.weightPct.toFixed(2)}%</span>
                  </p>
                  <p className="text-[12.5px] text-stone">
                    {vaultSlices[selectedVaultIdx]?.votedSeat
                      ? "Community Ballot seat preview"
                      : "Clean Lens check · Dripping to stakers"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onInspectCoin(activeCoin.token)}
                  className="btn-secondary min-h-[38px] px-3.5 text-[12.5px]"
                >
                  Proof
                </button>
              </div>
            )}
          </div>

          {/* Minimalist 10-Coin Index Table */}
          <div className="lg:col-span-7">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {vaultSlices.map((coin, idx) => {
                const selected = idx === selectedVaultIdx;
                return (
                  <button
                    key={`${coin.token}-${idx}`}
                    type="button"
                    onClick={() => setSelectedVaultIdx(idx)}
                    className={`flex min-h-[50px] cursor-pointer items-center justify-between rounded-[14px] px-4 py-2.5 text-left transition-colors ${
                      selected
                        ? "bg-well text-ink shadow-sm"
                        : "bg-surface/80 text-ink hover:bg-well"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`num text-[11.5px] font-semibold ${
                          selected ? "text-signal" : "text-stone-light"
                        }`}
                      >
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="text-[14.5px] font-extrabold tracking-tight">
                        {coin.symbol}
                      </span>
                      {coin.votedSeat && (
                        <span className="text-[11px] font-bold text-forest">
                          · Ballot
                        </span>
                      )}
                    </div>
                    <span className={`num text-[13.5px] font-bold ${selected ? "text-signal" : "text-ink"}`}>
                      {coin.weightPct.toFixed(2)}%
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-stone">
              <span>7 seats by clean trading volume · 3 seats by staker Ballot</span>
              {activeCoin && (
                <a
                  href={explorer("token", activeCoin.token)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-bold text-ink hover:underline"
                >
                  {activeCoin.symbol} on explorer
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 5. THREE MINIMALIST ARCHITECTURAL PILLARS */}
      <section className="grid grid-cols-1 gap-8 pt-10 md:grid-cols-3 md:gap-10">
        <div className="flex flex-col justify-between">
          <div>
            <p className="ui-label">01 · Boost</p>
            <h3 className="heading-card mt-2 text-[21px] text-ink">HYPE Pass</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-stone">
              Prove you hold HYPE with one free wallet signature for up to 1.25× rewards and +3 Ballot votes. Your wallet address stays private.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenPass}
            className="mt-5 inline-flex min-h-[44px] w-fit cursor-pointer items-center gap-1.5 text-[14px] font-extrabold text-ink hover:text-signal"
          >
            <span>Link HYPE Pass</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col justify-between">
          <div>
            <p className="ui-label">02 · Curate</p>
            <h3 className="heading-card mt-2 text-[21px] text-ink">The Ballot</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-stone">
              Stakers pick up to 3 clean candidate coins with a free signature. Top vote-getters claim 3 seats in the next Vault round.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("vote")}
            className="mt-5 inline-flex min-h-[44px] w-fit cursor-pointer items-center gap-1.5 text-[14px] font-extrabold text-ink hover:text-signal"
          >
            <span>Open Round {live.vote?.round ?? 5} Ballot</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col justify-between">
          <div>
            <p className="ui-label">03 · Create</p>
            <h3 className="heading-card mt-2 text-[21px] text-ink">Fee Lock</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-stone">
              Launch your own coin on Ascend with permanent contract rules that burn sell fees, pay a wallet, or feed CANON’s Vault.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenFeeLock}
            className="mt-5 inline-flex min-h-[44px] w-fit cursor-pointer items-center gap-1.5 text-[14px] font-extrabold text-ink hover:text-signal"
          >
            <span>Launch with Fee Lock</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>
  );
}
