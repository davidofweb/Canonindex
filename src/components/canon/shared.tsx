import { useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, parseUnits, type TransactionReceipt } from "viem";
import { useBlock, useConfig, useConnection, useWriteContract } from "wagmi";
import { getPublicClient, waitForTransactionReceipt } from "wagmi/actions";
import { ArrowUpRight } from "lucide-react";
import { elysium, explorer } from "@/lib/chain/config";
import { setTheme, THEMES, useTheme } from "@/lib/theme";

export type Hex = `0x${string}`;

export type TabKey = "home" | "trade" | "earn" | "vote" | "lens";

export function ThemeSwitcher({ className = "" }: { className?: string }) {
  const activeTheme = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={`inline-flex flex-wrap items-center gap-1 rounded-[12px] border border-line bg-well p-1 ${className}`}
    >
      {THEMES.map((t) => {
        const active = t.id === activeTheme;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(t.id)}
            className={`inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-[9px] px-2.5 text-[12px] font-bold tracking-[-0.01em] transition-colors ${
              active
                ? "bg-surface text-ink ring-1 ring-line-strong"
                : "text-stone hover:text-ink"
            }`}
          >
            <span
              aria-hidden="true"
              className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ring-1 ring-black/15"
              style={{ backgroundColor: t.canvasHex }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: t.signalHex }}
              />
            </span>
            <span>{t.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

export function useTx() {
  const config = useConfig();
  const { address } = useConnection();
  const qc = useQueryClient();
  const { mutateAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<Hex | null>(null);
  const running = useRef(false);

  const run = async (
    label: string | readonly string[],
    calls: readonly Parameters<typeof mutateAsync>[0][],
  ): Promise<TransactionReceipt[] | null> => {
    if (running.current) return null;
    running.current = true;
    const step = (i: number) => `${typeof label === "string" ? label : (label[i] ?? label[label.length - 1])}…`;
    setBusy(step(0));
    setError(null);
    const receipts: TransactionReceipt[] = [];
    let pending: Hex | null = null;
    try {
      for (const [i, call] of calls.entries()) {
        setBusy(step(i));
        const client = getPublicClient(config, { chainId: elysium.id });
        if (!client) throw new Error("No connection to Elysium testnet.");
        const estimate = await client.estimateContractGas({
          ...call,
          account: address,
        } as Parameters<typeof client.estimateContractGas>[0]);
        const hash = await mutateAsync({ ...call, gas: (estimate * 3n) / 2n + 100_000n });
        pending = hash;
        setLastTx(hash);
        receipts.push(
          await waitForTransactionReceipt(config, {
            hash,
            timeout: 180_000,
            retryCount: 12,
            retryDelay: 2_000,
          }),
        );
        pending = null;
      }
      await qc.invalidateQueries();
      return receipts;
    } catch (e) {
      setError(
        pending
          ? "Your transaction was sent, though confirmation is taking extra time. Check it on the explorer before sending again."
          : plainReason(e),
      );
      return null;
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  const reset = () => {
    setError(null);
    setLastTx(null);
  };

  return { run, busy, error, lastTx, reset };
}

export function TxFeedback({ error, lastTx }: { error: string | null; lastTx: Hex | null }) {
  if (error) {
    return (
      <p className="mt-3 border-t border-line pt-3 text-[13px] leading-snug text-crimson">
        {error}
        {lastTx && error.startsWith("Your transaction was sent") && (
          <>
            {" "}
            <a
              href={explorer("tx", lastTx)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-bold underline underline-offset-2"
            >
              Receipt
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </>
        )}
      </p>
    );
  }

  if (lastTx) {
    return (
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-[13px]">
        <span className="font-bold text-forest">Confirmed on Elysium</span>
        <a
          href={explorer("tx", lastTx)}
          target="_blank"
          rel="noreferrer"
          className="num inline-flex items-center gap-1 font-semibold text-ink underline underline-offset-2"
        >
          {short(lastTx)}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    );
  }

  return null;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="canon-well inline-flex w-full rounded-[16px] p-1"
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={`min-h-[42px] flex-1 cursor-pointer rounded-[12px] px-3 text-[13.5px] font-bold tracking-[-0.015em] transition-all duration-150 active:scale-[0.98] ${
              active
                ? "bg-surface/95 text-ink shadow-[0_4px_12px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.22)] ring-1 ring-line-strong/80"
                : "text-stone hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function useNow(): number {
  return useSyncExternalStore(
    (tick) => {
      const id = setInterval(tick, 1_000);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / 1_000),
    () => 0,
  );
}

export function useChainNow(): number {
  const block = useBlock({ watch: true });
  return Math.max(useNow(), Number(block.data?.timestamp ?? 0));
}

export function parseTokenAmount(v: string, decimals = 18): bigint | null {
  if (!v || v === ".") return null;
  try {
    return parseUnits(v, decimals);
  } catch {
    return null;
  }
}

export function fmt(v: bigint | undefined, decimals = 18): string {
  if (v === undefined) return "—";
  const n = Number(formatUnits(v, decimals));
  if (n === 0) return "0";
  if (n >= 1e6) {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(n);
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 2 });
}

export function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

const DAY = 86_400;

export function until(sec: number): string {
  const safe = Math.max(0, sec);
  const d = Math.floor(safe / DAY);
  const h = Math.floor((safe % DAY) / 3_600);
  const m = Math.max(1, Math.ceil((safe % 3_600) / 60));
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function plainReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/rejected|denied/i.test(msg)) return "You cancelled it in your wallet.";
  if (/Provider not found|No injected provider/i.test(msg)) {
    return "No browser wallet found. Open this page in MetaMask, Rabby, or Coinbase Wallet and try again.";
  }
  if (/PriceLimitAlreadyExceeded|PriceLimitOutOfBounds/.test(msg)) {
    return "That pool has no tokens left at the current range right now.";
  }
  if (/insufficient funds|exceeds the balance of the account|gas required exceeds/i.test(msg)) {
    return "This wallet needs a bit of free test HYPE for gas. Claim some from the faucet and wait a few seconds.";
  }
  if (/nonce too low|replacement transaction underpriced|already known/i.test(msg)) {
    return "Your wallet is still finishing an earlier step. Wait a few seconds and try again.";
  }
  if (/LaunchesArePaused|0x3a1455a0|HookNotAllowed|0xaf73e17a|ProtocolFeeCannotBeFetched/.test(msg)) {
    return "Ascend has paused new testnet launches ahead of mainnet. Launches reopen automatically once Ascend flips the switch back on.";
  }
  const named = msg.match(/reverted with the following reason:\s*\n?(.+)|error\s+([A-Z][A-Za-z]+)\(/);
  if (named) return `The contract declined: ${(named[1] ?? named[2]).trim()}.`;
  return `${msg.split("\n")[0].slice(0, 150)} Try again in a few seconds.`;
}
