import { useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { isAddress } from "viem";
import { headline, rounds, when, type Delphi } from "@/lib/delphi";
import { CodeScramble, ContractRibbon } from "./code-art";
import { SegmentedControl, short } from "./shared";
import { verdictTone } from "./sheets";
import { AddressScanReadout, YoyoLiquidCapsule } from "./yoyo-eye";

type LensFilter = "ALL" | "CLEAN" | "WATCH" | "FLAG";

export function LensView({
  delphi,
  currentRound,
  onInspectCoin,
  onOpenFeeLock,
  onOpenDispute,
}: {
  delphi: Delphi;
  currentRound: number | null;
  onInspectCoin: (token: string) => void;
  onOpenFeeLock: () => void;
  onOpenDispute: () => void;
}) {
  const [filter, setFilter] = useState<LensFilter>("ALL");
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const isHexQuery = trimmedQuery.toLowerCase().startsWith("0x") && trimmedQuery.length >= 4;
  const validHexAddress = isHexQuery && isAddress(trimmedQuery);

  const filteredCoins = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    return delphi.coins.filter((c) => {
      if (filter !== "ALL" && c.verdict !== filter) return false;
      if (!q) return true;
      return (
        (c.symbol?.toLowerCase().includes(q) ?? false) ||
        (c.name?.toLowerCase().includes(q) ?? false) ||
        c.token.toLowerCase().includes(q)
      );
    });
  }, [delphi.coins, filter, trimmedQuery]);

  const roundHistory = rounds(currentRound);

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="ui-label">
            The Lens · {delphi.scannedAt ? `Scanned ${when(delphi.scannedAt)}` : "Elysium Scan"}
          </p>
          <h1 className="heading-section mt-1.5 text-[32px] text-ink sm:text-[38px]">
            Coin Proof &amp; Fee Lock
          </h1>
          <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-stone">
            Every coin on Ascend is checked for 30-second launch bundles, wash loops, and top-holder share before it can enter The Vault.
          </p>
        </div>

        <p className="num text-[13px] font-semibold text-stone">
          <CodeScramble value={`${filteredCoins.length}`} /> shown ·{" "}
          <span className="font-bold text-forest">{delphi.counts.CLEAN} Clean</span> ·{" "}
          <span className="font-bold text-crimson">{delphi.counts.FLAG} Flagged</span>
        </p>
      </div>

      <ContractRibbon highlight={`lens.scan(${filter.toLowerCase()})`} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
        <section className="canon-card p-5 sm:p-6 lg:col-span-8">
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-stone" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ticker or paste 0x address to verify…"
                aria-label="Search scanned coins"
                className="canon-input min-h-[46px] w-full pr-4 pl-10 text-[14.5px] font-semibold"
              />
            </div>

            {isHexQuery && (
              <div className="flex items-center justify-between gap-3 rounded-[18px] bg-well px-3.5 py-2.5 ring-1 ring-line">
                <div className="flex min-w-0 items-center gap-3">
                  <YoyoLiquidCapsule
                    size="compact"
                    posture={
                      validHexAddress
                        ? filteredCoins.length > 0
                          ? "confirm"
                          : "alert"
                        : "scan"
                    }
                    ariaLabel="YOYO 0x address scanner"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-extrabold tracking-tight text-ink">
                      {!validHexAddress
                        ? "Scanning 0x prefix…"
                        : filteredCoins.length > 0
                          ? `Verified in Lens · ${filteredCoins[0].symbol ?? short(filteredCoins[0].token)}`
                          : "Valid 0x address · Not yet in Ascend scan"}
                    </p>
                    <div className="flex items-center gap-1.5 text-[12px] text-stone">
                      <AddressScanReadout
                        address={trimmedQuery}
                        scanning={!validHexAddress}
                      />
                    </div>
                  </div>
                </div>

                {validHexAddress && filteredCoins.length === 1 && (
                  <button
                    type="button"
                    onClick={() => onInspectCoin(filteredCoins[0].token)}
                    className="btn-signal min-h-[38px] shrink-0 px-3.5 text-[12.5px]"
                  >
                    Open Proof
                  </button>
                )}
              </div>
            )}

            <SegmentedControl<LensFilter>
              ariaLabel="Filter coins by verdict"
              value={filter}
              onChange={setFilter}
              options={[
                { id: "ALL", label: `All (${delphi.counts.coins})` },
                { id: "CLEAN", label: `Clean (${delphi.counts.CLEAN})` },
                { id: "WATCH", label: `Watch (${delphi.counts.WATCH})` },
                { id: "FLAG", label: `Flagged (${delphi.counts.FLAG})` },
              ]}
            />
          </div>

          {filteredCoins.length === 0 ? (
            <p className="py-10 text-center text-[14px] text-stone">
              No scanned coins match that filter.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {filteredCoins.map((coin) => {
                const tone = verdictTone(coin.verdict);
                return (
                  <li key={coin.token}>
                    <button
                      type="button"
                      onClick={() => onInspectCoin(coin.token)}
                      className="flex min-h-[60px] w-full cursor-pointer items-center justify-between gap-4 py-3 text-left transition-colors hover:bg-well sm:rounded-xl sm:px-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-[15.5px] font-extrabold tracking-tight text-ink">
                            {coin.symbol ?? short(coin.token)}
                          </span>
                          <span className="num text-[12px] text-stone">
                            · {coin.trades} trades · {coin.wallets} traders · {coin.holders} holders
                          </span>
                        </div>
                        {coin.headline && (
                          <p className="mt-0.5 truncate text-[13px] text-stone">
                            {headline(coin.headline)}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`text-[12.5px] font-bold ${tone.colorClass}`}>
                          {tone.text}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-stone-light" />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="space-y-7 lg:col-span-4">
          <div className="canon-card p-5">
            <p className="ui-label">Ownerless Creator Router</p>
            <h2 className="heading-card mt-1.5 text-[20px] text-ink">Launch with Fee Lock</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-stone">
              Deploy your own coin on Ascend with permanent rules for its 0.5% creator fee—burn supply on sells, feed CANON’s Vault on buys, or split with a wallet.
            </p>
            <button
              type="button"
              onClick={onOpenFeeLock}
              className="code-glitch btn-signal mt-5 w-full"
            >
              Open Fee Lock Launcher
            </button>
          </div>

          {roundHistory && (
            <div className="border-t border-line pt-5">
              <p className="ui-label">Vault Round {roundHistory.current.round}</p>
              <p className="num mt-2 text-[13px] font-bold leading-relaxed text-ink">
                {roundHistory.current.symbols.join(" · ")}
              </p>
              {roundHistory.previous && (
                <>
                  <p className="ui-label mt-4">Round {roundHistory.previous.round}</p>
                  <p className="num mt-1.5 text-[12.5px] leading-relaxed text-stone">
                    {roundHistory.previous.symbols.join(" · ")}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="border-t border-line pt-5">
            <p className="ui-label">Disputes</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-stone">
              Every check cites public explorer transactions. If a pattern misread independent trades, submit the proof.
            </p>
            <button
              type="button"
              onClick={onOpenDispute}
              className="btn-secondary mt-3.5 w-full"
            >
              Challenge a Check
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
