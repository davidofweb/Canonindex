import { useState } from "react";
import { erc20Abi, formatUnits, zeroAddress } from "viem";
import { useConnection, useReadContracts } from "wagmi";
import { hypePassportRegistryAbi, pantheonStakingAbi } from "@/lib/chain/abi";
import { deployment, elysium } from "@/lib/chain/config";
import { CodeScramble, ContractRibbon } from "./code-art";
import {
  fmt,
  parseTokenAmount,
  SegmentedControl,
  short,
  TxFeedback,
  until,
  useChainNow,
  useTx,
  type Hex,
  type TabKey,
} from "./shared";

const DAY_SEC = 86_400;
type StakeTab = "stake" | "unstake";

export function EarnView({
  onOpenWallet,
  onOpenPass,
  onNavigate,
}: {
  onOpenWallet: () => void;
  onOpenPass: () => void;
  onNavigate: (tab: TabKey) => void;
}) {
  const { address, isConnected, chainId } = useConnection();
  const onChain = isConnected && chainId === elysium.id;
  const me = (address ?? zeroAddress) as Hex;
  const now = useChainNow();
  const tx = useTx();

  const [tab, setTab] = useState<StakeTab>("stake");
  const [amount, setAmount] = useState("");

  const d = deployment;

  const coreReads = useReadContracts({
    contracts: d
      ? [
          { address: d.pnth, abi: erc20Abi, functionName: "balanceOf", args: [me] },
          { address: d.pnth, abi: erc20Abi, functionName: "allowance", args: [me, d.staking] },
          { address: d.staking, abi: pantheonStakingAbi, functionName: "accounts", args: [me] },
          { address: d.staking, abi: pantheonStakingAbi, functionName: "totalStaked" },
          { address: d.staking, abi: pantheonStakingAbi, functionName: "totalWorking" },
          { address: d.staking, abi: pantheonStakingAbi, functionName: "rewardTokens" },
          { address: d.passportRegistry, abi: hypePassportRegistryAbi, functionName: "multiplierOf", args: [me] },
        ]
      : [],
    query: { enabled: !!d, refetchInterval: 7_000 },
  });

  const rewardTokens = ((coreReads.data?.[5]?.result as readonly Hex[] | undefined) ?? []);

  const rewardReads = useReadContracts({
    contracts: [
      ...rewardTokens.map((t) => ({ address: t, abi: erc20Abi, functionName: "symbol" }) as const),
      ...rewardTokens.map((t) => ({ address: t, abi: erc20Abi, functionName: "decimals" }) as const),
      ...(d
        ? rewardTokens.map(
            (t) =>
              ({
                address: d.staking,
                abi: pantheonStakingAbi,
                functionName: "earned",
                args: [t, me],
              }) as const,
          )
        : []),
    ],
    query: { enabled: !!d && rewardTokens.length > 0, refetchInterval: 7_000 },
  });

  if (!d) {
    return (
      <div className="canon-card p-6">
        <h1 className="heading-section text-[28px] text-ink">Stake &amp; Earn</h1>
        <p className="mt-2 text-[15px] text-stone">Staking contracts are not configured yet.</p>
      </div>
    );
  }

  const walletBal = onChain ? ((coreReads.data?.[0]?.result as bigint | undefined) ?? 0n) : 0n;
  const allowance = onChain ? ((coreReads.data?.[1]?.result as bigint | undefined) ?? 0n) : 0n;
  const accountTuple = onChain ? coreReads.data?.[2]?.result : undefined;
  const staked = accountTuple?.[0] ?? 0n;
  const cooling = accountTuple?.[1] ?? 0n;
  const working = accountTuple?.[2] ?? 0n;
  const coolEnd = Number(accountTuple?.[3] ?? 0);
  const stakeStart = Number(accountTuple?.[4] ?? 0);
  const totalStaked = (coreReads.data?.[3]?.result as bigint | undefined) ?? 0n;
  const totalWorking = (coreReads.data?.[4]?.result as bigint | undefined) ?? 0n;

  const passBoost = onChain
    ? Number((coreReads.data?.[6]?.result as bigint | undefined) ?? 10n ** 18n) / 1e18
    : 1;
  const ageSec = staked > 0n && stakeStart > 0 ? Math.max(now - stakeStart, 0) : 0;
  const timeBoost = 1 + 0.5 * Math.min(ageSec / (30 * DAY_SEC), 1);
  const totalBoost = timeBoost * passBoost;
  const poolSharePct =
    totalWorking > 0n && working > 0n ? (Number(working) / Number(totalWorking)) * 100 : 0;

  const rewardCount = rewardTokens.length;
  const rewards = rewardTokens.map((addr, idx) => ({
    address: addr,
    symbol: (rewardReads.data?.[idx]?.result as string | undefined) ?? short(addr),
    decimals: (rewardReads.data?.[rewardCount + idx]?.result as number | undefined) ?? 18,
    earned: onChain
      ? ((rewardReads.data?.[2 * rewardCount + idx]?.result as bigint | undefined) ?? 0n)
      : 0n,
  }));
  const hasClaimable = rewards.some((r) => r.earned > 0n);

  const maxAmount = tab === "stake" ? walletBal : staked;
  const parsed = parseTokenAmount(amount, 18);
  const validAmount = parsed !== null && parsed > 0n && parsed <= maxAmount;
  const cooldownReady = cooling > 0n && now >= coolEnd;

  const setPct = (pct: number) => {
    const target = (maxAmount * BigInt(pct)) / 100n;
    setAmount(target > 0n ? formatUnits(target, 18) : "0");
  };

  const handleSubmit = async () => {
    if (!validAmount || !parsed) return;
    if (tab === "stake") {
      const calls = [
        ...(allowance < parsed
          ? [
              {
                address: d.pnth,
                abi: erc20Abi,
                functionName: "approve",
                args: [d.staking, parsed],
              } as const,
            ]
          : []),
        {
          address: d.staking,
          abi: pantheonStakingAbi,
          functionName: "stake",
          args: [parsed],
        } as const,
      ];
      const ok = await tx.run(
        allowance < parsed ? ["Approving $CANON (1/2)", "Staking $CANON (2/2)"] : "Staking $CANON",
        calls,
      );
      if (ok) setAmount("");
    } else {
      const ok = await tx.run("Starting 3-day unlock", [
        {
          address: d.staking,
          abi: pantheonStakingAbi,
          functionName: "requestUnstake",
          args: [parsed],
        } as const,
      ]);
      if (ok) setAmount("");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="ui-label">Vault Yield · Elysium Testnet</p>
          <h1 className="heading-section mt-1.5 text-[32px] text-ink sm:text-[38px]">
            Stake &amp; Earn
          </h1>
          <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-stone">
            Every $CANON buy adds top Ascend coins to The Vault and drips them to stakers over 7 days.
          </p>
        </div>
        <p className="num text-[13px] font-semibold text-stone">
          Total Staked: <span className="font-bold text-ink">{fmt(totalStaked)} $CANON</span>
        </p>
      </div>

      <ContractRibbon highlight={tab === "stake" ? "staking.stake(amount)" : "staking.requestUnstake(amount)"} />

      {/* Architectural Hairline Summary Metrics */}
      <section className="grid grid-cols-2 gap-y-6 gap-x-6 border-b border-line pb-8 sm:grid-cols-4">
        <div>
          <p className="ui-label">Staked</p>
          <p className="num mt-1.5 text-[26px] font-extrabold text-ink">
            <CodeScramble value={onChain ? fmt(staked) : "—"} />
          </p>
          <p className="mt-0.5 text-[12px] text-stone">
            {poolSharePct > 0
              ? `${poolSharePct < 0.01 ? "<0.01" : poolSharePct.toFixed(2)}% of pool`
              : "$CANON earning"}
          </p>
        </div>

        <div>
          <p className="ui-label">In Wallet</p>
          <p className="num mt-1.5 text-[26px] font-extrabold text-ink">
            <CodeScramble value={onChain ? fmt(walletBal) : "—"} />
          </p>
          <button
            type="button"
            onClick={() => onNavigate("trade")}
            className="mt-0.5 cursor-pointer text-[12px] font-bold text-ink hover:text-signal"
          >
            Get $CANON →
          </button>
        </div>

        <div>
          <p className="ui-label">Unlocking</p>
          <p className="num mt-1.5 text-[26px] font-extrabold text-ink">
            <CodeScramble value={onChain ? fmt(cooling) : "—"} />
          </p>
          <p className="mt-0.5 text-[12px] text-stone">
            {cooling > 0n
              ? cooldownReady
                ? "Ready now"
                : `${until(coolEnd - now)} left`
              : "3-day cooldown"}
          </p>
        </div>

        <div>
          <p className="ui-label">Boost</p>
          <p className="num mt-1.5 text-[26px] font-extrabold text-forest">
            <CodeScramble value={onChain ? `${totalBoost.toFixed(2)}×` : "1.00×"} />
          </p>
          <p className="mt-0.5 text-[12px] text-stone">Up to 1.88× max</p>
        </div>
      </section>

      {/* Active 3-Day Cooldown Strip */}
      {onChain && cooling > 0n && (
        <div className="flex flex-col justify-between gap-4 rounded-[18px] border border-signal bg-surface p-5 sm:flex-row sm:items-center">
          <div>
            <p className="ui-label text-signal">Cooldown Active</p>
            <p className="heading-card mt-1 text-[17px] text-ink">
              {cooldownReady
                ? `${fmt(cooling)} $CANON is ready to withdraw`
                : `${fmt(cooling)} $CANON unlocking · Ready in ${until(coolEnd - now)}`}
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {cooldownReady && (
              <button
                type="button"
                disabled={!!tx.busy}
                onClick={() =>
                  tx.run("Withdrawing $CANON", [
                    { address: d.staking, abi: pantheonStakingAbi, functionName: "withdraw" },
                  ])
                }
                className="btn-signal min-h-[42px] px-4 text-[13.5px]"
              >
                {tx.busy ?? "Withdraw Now"}
              </button>
            )}
            <button
              type="button"
              disabled={!!tx.busy}
              onClick={() =>
                tx.run("Returning to stake", [
                  { address: d.staking, abi: pantheonStakingAbi, functionName: "cancelUnstake" },
                ])
              }
              className="btn-secondary min-h-[42px] px-4 text-[13.5px]"
            >
              Keep Staked
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
        {/* STAKE / UNSTAKE CARD */}
        <section className="canon-card p-5 sm:p-6 lg:col-span-7">
          <SegmentedControl<StakeTab>
            ariaLabel="Stake or unstake $CANON"
            value={tab}
            onChange={(next) => {
              setTab(next);
              setAmount("");
            }}
            options={[
              { id: "stake", label: "Stake" },
              { id: "unstake", label: "Unstake (3d)" },
            ]}
          />

          <div className="canon-well mt-4 p-4 sm:p-5">
            <div className="flex items-center justify-between text-[12.5px] font-semibold text-stone">
              <span>{tab === "stake" ? "Amount to stake" : "Amount to unlock"}</span>
              <span className="num">Available: {fmt(maxAmount)} $CANON</span>
            </div>

            <div className="mt-2 flex items-baseline justify-between gap-3">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                aria-label="Token amount"
                className="num w-full bg-transparent text-[32px] font-extrabold tracking-tight text-ink placeholder:text-stone-light focus:outline-none sm:text-[36px]"
              />
              <span className="shrink-0 text-[15px] font-extrabold text-ink">$CANON</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {[25, 50, 75].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  disabled={maxAmount === 0n}
                  onClick={() => setPct(pct)}
                  className="num min-h-[34px] cursor-pointer rounded-[9px] bg-surface px-3 text-[12.5px] font-bold text-ink ring-1 ring-line hover:bg-well-hover disabled:opacity-40"
                >
                  {pct}%
                </button>
              ))}
              <button
                type="button"
                disabled={maxAmount === 0n}
                onClick={() => setPct(100)}
                className="min-h-[34px] cursor-pointer rounded-[9px] bg-surface px-3 text-[12.5px] font-bold text-signal ring-1 ring-line hover:bg-well-hover disabled:opacity-40"
              >
                Max
              </button>
            </div>
          </div>

          <p className="mt-3 text-[12.5px] leading-relaxed text-stone">
            {tab === "stake"
              ? "Starts your Vault coin stream immediately and grants 1 Ballot vote every round."
              : "Pauses rewards on that amount for 3 days before returning to your wallet."}
          </p>

          <div className="mt-5">
            {!onChain ? (
              <button type="button" onClick={onOpenWallet} className="btn-primary w-full">
                Connect Wallet to Stake
              </button>
            ) : (
              <button
                type="button"
                disabled={!validAmount || !!tx.busy}
                onClick={handleSubmit}
                className="code-glitch btn-signal w-full"
              >
                {tx.busy ??
                  (!parsed || parsed === 0n
                    ? "Enter Amount"
                    : parsed > maxAmount
                      ? "Exceeds Balance"
                      : tab === "stake"
                        ? "Stake $CANON"
                        : "Start 3-Day Unlock")}
              </button>
            )}
          </div>

          <TxFeedback error={tx.error} lastTx={tx.lastTx} />
        </section>

        {/* STREAMING VAULT REWARDS & BOOSTS */}
        <aside className="space-y-7 lg:col-span-5">
          <div>
            <p className="ui-label">Vault Coin Stream</p>
            {rewards.length === 0 ? (
              <p className="mt-3 text-[14px] text-stone">
                Vault coins stream here automatically after index fee buys.
              </p>
            ) : (
              <ul className="mt-3 max-h-[240px] divide-y divide-line overflow-y-auto border-y border-line">
                {rewards.map((r) => (
                  <li key={r.address} className="flex items-center justify-between py-2.5 text-[14px]">
                    <span className="font-bold text-ink">{r.symbol}</span>
                    <span
                      className={`num font-bold ${
                        r.earned > 0n ? "text-forest" : "text-stone-light"
                      }`}
                    >
                      {fmt(r.earned, r.decimals)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              disabled={!onChain || !hasClaimable || !!tx.busy}
              onClick={() =>
                tx.run("Claiming Vault coins", [
                  { address: d.staking, abi: pantheonStakingAbi, functionName: "claim" },
                ])
              }
              className="btn-primary mt-4 w-full"
            >
              {tx.busy ?? (hasClaimable ? "Claim All Vault Coins" : "No Rewards Ready Yet")}
            </button>
          </div>

          <div>
            <p className="ui-label">Reward Multipliers</p>
            <div className="mt-3 divide-y divide-line border-y border-line text-[13.5px]">
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-bold text-ink">Time Bonus</p>
                  <p className="text-[12px] text-stone">Ramps to 1.50× over 30 days</p>
                </div>
                <span className="num text-[14.5px] font-bold text-ink">
                  {timeBoost.toFixed(2)}×
                </span>
              </div>

              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-bold text-ink">HYPE Pass</p>
                  <p className="text-[12px] text-stone">1.10× to 1.25× for HYPE holders</p>
                </div>
                <span className="num text-[14.5px] font-bold text-forest">
                  {passBoost.toFixed(2)}×
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenPass}
              className="btn-secondary mt-4 w-full"
            >
              {passBoost > 1 ? "Manage HYPE Pass" : "Link HYPE Pass (+25% Boost)"}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
