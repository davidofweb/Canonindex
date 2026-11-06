import { useState } from "react";
import {
  encodeAbiParameters,
  erc20Abi,
  formatUnits,
  keccak256,
  pad,
  parseAbi,
  parseUnits,
  toHex,
  zeroAddress,
} from "viem";
import { useBalance, useConnection, useReadContracts } from "wagmi";
import { ArrowDown, ArrowUpRight, Check, Plus } from "lucide-react";
import { swapperAbi } from "@/lib/chain/abi";
import { deployment, elysium, explorer } from "@/lib/chain/config";
import { CodeScramble, ContractRibbon } from "./code-art";
import {
  fmt,
  SegmentedControl,
  TxFeedback,
  useTx,
  type Hex,
  type TabKey,
} from "./shared";

const FAUCET_URL = "https://elysium.kinetiq.xyz/testnet-faucet";
const MINT_USDC_AMOUNT = 1_000n * 10n ** 6n;
const SOLD_OUT_FLOOR = 1_000n * 10n ** 18n;

const LAUNCHPAD_ABI = parseAbi([
  "function poolManager() view returns (address)",
  "function vault() view returns (address)",
  "function emaSqrtPrice(bytes32 poolId) view returns (uint160)",
]);

const DRIP_ABI = parseAbi([
  "function claim()",
  "function claimed(address) view returns (bool)",
  "function amount() view returns (uint256)",
]);

const MINTABLE_USDC_ABI = parseAbi(["function mint(address to, uint256 value)"]);

const DYNAMIC_FEE = 0x800000;
const POOL_PARAMETERS = pad(toHex(0x0445 | (200 << 16)), { size: 32 });
const POOL_KEY_TUPLE = [
  {
    type: "tuple",
    components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "hooks", type: "address" },
      { name: "poolManager", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "parameters", type: "bytes32" },
    ],
  },
] as const;

function buildPoolKey(token: Hex, quote: Hex, launchpad: Hex, poolManager: Hex) {
  const tokenIs0 = BigInt(token) < BigInt(quote);
  return {
    currency0: tokenIs0 ? token : quote,
    currency1: tokenIs0 ? quote : token,
    hooks: launchpad,
    poolManager,
    fee: DYNAMIC_FEE,
    parameters: POOL_PARAMETERS,
  } as const;
}

function estimateBuyOut(usdcIn: bigint, sqrtP: bigint, canonIs0: boolean): bigint {
  if (sqrtP === 0n || usdcIn <= 0n) return 0n;
  const q192 = 1n << 192n;
  const raw = canonIs0 ? (usdcIn * q192) / (sqrtP * sqrtP) : (usdcIn * sqrtP * sqrtP) / q192;
  return (raw * 99n) / 100n;
}

function estimateSellOut(canonIn: bigint, sqrtP: bigint, canonIs0: boolean): bigint {
  if (sqrtP === 0n || canonIn <= 0n) return 0n;
  const q192 = 1n << 192n;
  const raw = canonIs0 ? (canonIn * sqrtP * sqrtP) / q192 : (canonIn * q192) / (sqrtP * sqrtP);
  return (raw * 99n) / 100n;
}

type TradeSide = "buy" | "sell";

export function TradeView({
  onOpenWallet,
  onNavigate,
}: {
  onOpenWallet: () => void;
  onNavigate: (tab: TabKey) => void;
}) {
  const { address, isConnected, chainId } = useConnection();
  const onChain = isConnected && chainId === elysium.id;
  const me = (address ?? zeroAddress) as Hex;
  const tx = useTx();

  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("100");

  const d = deployment;
  const swapper = d?.swapper as Hex | undefined;
  const drip = d?.drip as Hex | undefined;

  const hype = useBalance({
    address: me,
    chainId: elysium.id,
    query: {
      enabled: onChain,
      refetchInterval: (q) => ((q.state.data?.value ?? 0n) > 0n ? 10_000 : 3_000),
    },
  });

  const baseReads = useReadContracts({
    contracts:
      d && swapper
        ? [
            { address: d.usdc, abi: erc20Abi, functionName: "balanceOf", args: [me] },
            { address: d.pnth, abi: erc20Abi, functionName: "balanceOf", args: [me] },
            { address: d.usdc, abi: erc20Abi, functionName: "allowance", args: [me, swapper] },
            { address: d.pnth, abi: erc20Abi, functionName: "allowance", args: [me, swapper] },
            { address: d.launchpad, abi: LAUNCHPAD_ABI, functionName: "poolManager" },
            { address: d.launchpad, abi: LAUNCHPAD_ABI, functionName: "emaSqrtPrice", args: [d.pnthPool] },
            { address: d.launchpad, abi: LAUNCHPAD_ABI, functionName: "vault" },
          ]
        : [],
    query: { enabled: !!d && !!swapper, refetchInterval: 9_000 },
  });

  const ascendVault = baseReads.data?.[6]?.result as Hex | undefined;

  const extraReads = useReadContracts({
    contracts: d
      ? [
          { address: d.pnth, abi: erc20Abi, functionName: "balanceOf", args: [ascendVault ?? zeroAddress] },
          { address: drip ?? zeroAddress, abi: DRIP_ABI, functionName: "claimed", args: [me] },
          { address: drip ?? zeroAddress, abi: DRIP_ABI, functionName: "amount" },
          { address: d.pnth, abi: erc20Abi, functionName: "balanceOf", args: [drip ?? zeroAddress] },
        ]
      : [],
    query: { enabled: !!d && !!ascendVault, refetchInterval: 9_000 },
  });

  if (!d || !swapper) {
    return (
      <div className="canon-card p-6">
        <h1 className="heading-section text-[28px] text-ink">Trade $CANON</h1>
        <p className="mt-2 text-[15px] text-stone">
          Swap contracts are not configured for this environment yet.
        </p>
      </div>
    );
  }

  const usdcBal = onChain ? ((baseReads.data?.[0]?.result as bigint | undefined) ?? 0n) : 0n;
  const canonBal = onChain ? ((baseReads.data?.[1]?.result as bigint | undefined) ?? 0n) : 0n;
  const usdcAllowance = onChain ? ((baseReads.data?.[2]?.result as bigint | undefined) ?? 0n) : 0n;
  const canonAllowance = onChain ? ((baseReads.data?.[3]?.result as bigint | undefined) ?? 0n) : 0n;
  const poolManager = baseReads.data?.[4]?.result as Hex | undefined;
  const sqrtP = (baseReads.data?.[5]?.result as bigint | undefined) ?? 0n;

  const poolCanonLeft = extraReads.data?.[0]?.result as bigint | undefined;
  const soldOut = poolCanonLeft !== undefined && poolCanonLeft < SOLD_OUT_FLOOR;
  const dripClaimed = onChain && extraReads.data?.[1]?.result === true;
  const dripAmount = (extraReads.data?.[2]?.result as bigint | undefined) ?? 0n;
  const dripBalance = (extraReads.data?.[3]?.result as bigint | undefined) ?? 0n;
  const canClaimDrip = !!drip && dripAmount > 0n && dripBalance >= dripAmount && !dripClaimed;

  const hasGas = (hype.data?.value ?? 0n) > 0n;
  const key = poolManager ? buildPoolKey(d.pnth, d.usdc, d.launchpad, poolManager) : null;
  const keyValid =
    !!key && keccak256(encodeAbiParameters(POOL_KEY_TUPLE, [key])).toLowerCase() === d.pnthPool.toLowerCase();
  const canonIs0 = key?.currency0.toLowerCase() === d.pnth.toLowerCase();

  let parsedInput: bigint | null = null;
  try {
    parsedInput =
      amount && Number(amount) > 0 ? parseUnits(amount, side === "buy" ? 6 : 18) : null;
  } catch {
    parsedInput = null;
  }

  const estimatedOut =
    parsedInput && sqrtP > 0n
      ? side === "buy"
        ? estimateBuyOut(parsedInput, sqrtP, canonIs0)
        : estimateSellOut(parsedInput, sqrtP, canonIs0)
      : 0n;

  type Call = Parameters<ReturnType<typeof useTx>["run"]>[1][number];

  const executeSwap = async () => {
    if (!parsedInput || !key || !keyValid) return;
    const steps: [string, Call][] = [];

    if (side === "buy") {
      if (usdcBal < parsedInput) {
        steps.push([
          "Minting test USDC",
          { address: d.usdc, abi: MINTABLE_USDC_ABI, functionName: "mint", args: [me, parsedInput - usdcBal] },
        ]);
      }
      if (usdcAllowance < parsedInput) {
        steps.push([
          "Approving test USDC",
          { address: d.usdc, abi: erc20Abi, functionName: "approve", args: [swapper, parsedInput] },
        ]);
      }
      steps.push([
        "Buying $CANON",
        { address: swapper, abi: swapperAbi, functionName: "swapExactIn", args: [key, !canonIs0, parsedInput] },
      ]);
    } else {
      if (canonAllowance < parsedInput) {
        steps.push([
          "Approving $CANON",
          { address: d.pnth, abi: erc20Abi, functionName: "approve", args: [swapper, parsedInput] },
        ]);
      }
      steps.push([
        "Selling $CANON",
        { address: swapper, abi: swapperAbi, functionName: "swapExactIn", args: [key, canonIs0, parsedInput] },
      ]);
    }

    await tx.run(
      steps.map(([lbl], idx) => (steps.length > 1 ? `${lbl} (${idx + 1}/${steps.length})` : lbl)),
      steps.map(([, call]) => call),
    );
  };

  const setShare = (pct: number) => {
    if (side === "buy") {
      if (usdcBal === 0n) {
        setAmount(String(pct));
      } else {
        const val = (usdcBal * BigInt(pct)) / 100n;
        setAmount(formatUnits(val, 6));
      }
    } else {
      const val = (canonBal * BigInt(pct)) / 100n;
      setAmount(val > 0n ? formatUnits(val, 18) : "0");
    }
  };

  const swapDisabled =
    !onChain ||
    !hasGas ||
    !keyValid ||
    !parsedInput ||
    !!tx.busy ||
    (side === "buy" && soldOut) ||
    (side === "sell" && parsedInput > canonBal);

  const primaryButtonText = !onChain
    ? "Connect Wallet to Trade"
    : !hasGas
      ? "Claim Free HYPE Gas First"
      : !keyValid
        ? "Reading Pool…"
        : side === "buy" && soldOut
          ? "Pool Supply Sold Out"
          : !parsedInput
            ? "Enter Amount"
            : side === "sell" && parsedInput > canonBal
              ? "Insufficient $CANON Balance"
              : side === "buy" && parsedInput > usdcBal
                ? "Mint USDC & Buy $CANON"
                : side === "buy"
                  ? "Buy $CANON"
                  : "Sell $CANON";

  const outFormatted =
    parsedInput && estimatedOut > 0n ? fmt(estimatedOut, side === "buy" ? 18 : 6) : "0";

  return (
    <div className="space-y-8">
      <div>
        <p className="ui-label">Ascend Pool · Elysium Testnet</p>
        <h1 className="heading-section mt-1.5 text-[32px] text-ink sm:text-[38px]">
          Trade $CANON
        </h1>
        <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-stone">
          Swap with free test USDC on Elysium. Buys grow The Vault; sells burn $CANON permanently.
        </p>
      </div>

      <ContractRibbon highlight={side === "buy" ? "swapExactIn(USDC -> CANON)" : "swapExactIn(CANON -> USDC)"} />

      {/* Minimalist Free Drip Strip */}
      {canClaimDrip && drip && (
        <div className="flex flex-col justify-between gap-4 rounded-[18px] bg-surface p-5 sm:flex-row sm:items-center">
          <div>
            <p className="ui-label text-signal">One-Time Testnet Drip</p>
            <p className="heading-card mt-1 text-[18px] text-ink">
              Claim {fmt(dripAmount)} free $CANON in one wallet tap
            </p>
          </div>

          {!onChain ? (
            <button type="button" onClick={onOpenWallet} className="btn-primary shrink-0">
              Connect Wallet
            </button>
          ) : (
            <button
              type="button"
              disabled={!hasGas || !!tx.busy}
              onClick={() =>
                tx.run("Claiming free $CANON", [
                  { address: drip, abi: DRIP_ABI, functionName: "claim" },
                ])
              }
              className="btn-signal shrink-0"
            >
              {tx.busy ?? (hasGas ? `Claim ${fmt(dripAmount)} $CANON` : "Get HYPE Gas First")}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
        {/* MAIN SWAP WORKSPACE */}
        <section className="canon-card p-5 sm:p-6 lg:col-span-7">
          <SegmentedControl<TradeSide>
            ariaLabel="Choose buy or sell"
            value={side}
            onChange={(next) => {
              setSide(next);
              setAmount(next === "buy" ? "100" : canonBal > 0n ? formatUnits(canonBal / 4n, 18) : "100");
            }}
            options={[
              { id: "buy", label: "Buy $CANON" },
              { id: "sell", label: "Sell $CANON" },
            ]}
          />

          <div className="canon-well mt-4 p-4 sm:p-5">
            <div className="flex items-center justify-between text-[12.5px] font-semibold text-stone">
              <span>You {side === "buy" ? "spend" : "sell"}</span>
              <span className="num">
                Balance: {side === "buy" ? `${fmt(usdcBal, 6)} USDC` : `${fmt(canonBal)} $CANON`}
              </span>
            </div>

            <div className="mt-2 flex items-baseline justify-between gap-3">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                aria-label={side === "buy" ? "USDC amount to spend" : "$CANON amount to sell"}
                className="num w-full bg-transparent text-[32px] font-extrabold tracking-tight text-ink placeholder:text-stone-light focus:outline-none sm:text-[36px]"
              />
              <span className="shrink-0 text-[15px] font-extrabold text-ink">
                {side === "buy" ? "USDC" : "$CANON"}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {side === "buy"
                ? [25, 100, 500].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmount(String(preset))}
                      className="num min-h-[34px] cursor-pointer rounded-[9px] bg-surface px-3 text-[12.5px] font-bold text-ink hover:bg-well-hover"
                    >
                      ${preset}
                    </button>
                  ))
                : [25, 50, 75].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      disabled={canonBal === 0n}
                      onClick={() => setShare(pct)}
                      className="num min-h-[34px] cursor-pointer rounded-[9px] bg-surface px-3 text-[12.5px] font-bold text-ink hover:bg-well-hover disabled:opacity-40"
                    >
                      {pct}%
                    </button>
                  ))}
              <button
                type="button"
                disabled={side === "buy" ? usdcBal === 0n : canonBal === 0n}
                onClick={() => setShare(100)}
                className="min-h-[34px] cursor-pointer rounded-[9px] bg-surface px-3 text-[12.5px] font-bold text-signal hover:bg-well-hover disabled:opacity-40"
              >
                Max
              </button>
            </div>
          </div>

          <div className="my-2 flex justify-center" aria-hidden="true">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-stone">
              <ArrowDown className="h-3.5 w-3.5 stroke-[2.25]" />
            </span>
          </div>

          <div className="canon-well p-4 sm:p-5">
            <div className="flex items-center justify-between text-[12.5px] font-semibold text-stone">
              <span>Estimated output (after 1% fee)</span>
              <span className="num">EMA quote</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <span className="num text-[28px] font-extrabold tracking-tight text-ink sm:text-[32px]">
                <CodeScramble value={outFormatted} durationMs={160} />
              </span>
              <span className="shrink-0 text-[15px] font-extrabold text-ink">
                {side === "buy" ? "$CANON" : "USDC"}
              </span>
            </div>
          </div>

          <div className="mt-5">
            {!onChain ? (
              <button type="button" onClick={onOpenWallet} className="btn-primary w-full">
                Connect Wallet to Trade
              </button>
            ) : (
              <button
                type="button"
                disabled={swapDisabled}
                onClick={executeSwap}
                className="code-glitch btn-signal w-full"
              >
                {tx.busy ?? primaryButtonText}
              </button>
            )}
          </div>

          <TxFeedback error={tx.error} lastTx={tx.lastTx} />

          {canonBal > 0n && (
            <div className="mt-4 flex items-center justify-between gap-3 pt-4 text-[13.5px]">
              <span className="text-stone">
                Holding <strong className="num font-bold text-ink">{fmt(canonBal)} $CANON</strong>
              </span>
              <button
                type="button"
                onClick={() => onNavigate("earn")}
                className="cursor-pointer font-bold text-ink hover:text-signal"
              >
                Stake it →
              </button>
            </div>
          )}
        </section>

        {/* SIDEBAR: TESTNET FAUCETS & FEE TRANSPARENCY */}
        <aside className="space-y-6 lg:col-span-5">
          <div className="pt-5 lg:pt-0">
            <p className="ui-label">Testnet Supplies</p>
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="flex items-center gap-1.5 text-[14px] font-bold text-ink">
                    {hasGas && <Check className="h-4 w-4 text-forest" />}
                    Test HYPE (Gas)
                  </p>
                  <p className="num text-[12px] text-stone">
                    {onChain ? `${fmt(hype.data?.value)} HYPE` : "Free from faucet"}
                  </p>
                </div>
                <a
                  href={FAUCET_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary min-h-[38px] px-3.5 text-[12.5px]"
                >
                  Faucet
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </div>

              <div className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="flex items-center gap-1.5 text-[14px] font-bold text-ink">
                    {usdcBal > 0n && <Check className="h-4 w-4 text-forest" />}
                    Test USDC
                  </p>
                  <p className="num text-[12px] text-stone">
                    {onChain ? `${fmt(usdcBal, 6)} USDC` : "Mint free quote coins"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!onChain || !hasGas || !!tx.busy}
                  onClick={() =>
                    tx.run("Minting 1,000 test USDC", [
                      {
                        address: d.usdc,
                        abi: MINTABLE_USDC_ABI,
                        functionName: "mint",
                        args: [me, MINT_USDC_AMOUNT],
                      },
                    ])
                  }
                  className="btn-secondary min-h-[38px] px-3.5 text-[12.5px]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  1,000 USDC
                </button>
              </div>
            </div>
          </div>

          <div>
            <p className="ui-label">
              {side === "buy" ? "Buy Fee Route · 1.00%" : "Sell Fee Route · 1.00%"}
            </p>
            <div className="mt-3 space-y-1 text-[13.5px]">
              <div className="flex items-center justify-between py-2.5">
                <span className="text-stone">Ascend Exchange</span>
                <span className="num font-bold text-ink">0.500%</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-stone">
                  {side === "buy" ? "Vault Coin Purchases" : "Permanent $CANON Burn"}
                </span>
                <span
                  className={`num font-bold ${
                    side === "buy" ? "text-forest" : "text-signal"
                  }`}
                >
                  <CodeScramble value={side === "buy" ? "+0.425%" : "-0.425%"} />
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-stone">Keeper Operations</span>
                <span className="num font-bold text-ink">0.075%</span>
              </div>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-stone">
              Pool helper contract:{" "}
              <a
                href={explorer("address", swapper)}
                target="_blank"
                rel="noreferrer"
                className="num font-semibold text-ink underline underline-offset-2"
              >
                {swapper.slice(0, 8)}… ↗
              </a>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
