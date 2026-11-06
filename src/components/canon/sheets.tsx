import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { decodeEventLog, erc20Abi, isAddress, zeroAddress } from "viem";
import {
  useBalance,
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSignTypedData,
  useSwitchChain,
  useWatchAsset,
  type Connector,
} from "wagmi";
import {
  ArrowLeft,
  ArrowUpRight,
  Check as CheckIcon,
  Copy,
  LogOut,
  Plus,
  RefreshCw,
  Smartphone,
  Sparkles,
  Wallet,
} from "lucide-react";
import {
  covenantFactoryAbi,
  covenantRouterAbi,
  hypePassportRegistryAbi,
  pantheonStakingAbi,
} from "@/lib/chain/abi";
import { deployedFrom, deployment, elysium, ensureElysiumNetwork, explorer } from "@/lib/chain/config";
import {
  basketNote,
  headline,
  VERDICT,
  when,
  type Check,
  type Delphi,
  type Verdict,
} from "@/lib/delphi";
import { BottomSheet } from "./sheet";
import { CanonWalletSigil } from "./code-art";
import {
  fmt,
  plainReason,
  SegmentedControl,
  short,
  ThemeSwitcher,
  TxFeedback,
  until,
  useChainNow,
  useTx,
  type Hex,
} from "./shared";
import { YoyoVerifyStage } from "./yoyo-eye";
import { finishAddressVerify, startAddressVerify } from "@/lib/yoyo-loader";

const FAUCET_URL = "https://elysium.kinetiq.xyz/testnet-faucet";

function MinimalistQrMatrix({ uri }: { uri: string }) {
  const matrix = useMemo(() => {
    try {
      const qr = QRCode.create(uri, { errorCorrectionLevel: "Q" });
      const size = qr.modules.size;
      const cells: Array<{ x: number; y: number }> = [];
      const mid = (size - 1) / 2;
      const badgeRadius = 2.6;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (Math.abs(x - mid) <= badgeRadius && Math.abs(y - mid) <= badgeRadius) {
            continue;
          }
          if (qr.modules.get(y, x)) {
            cells.push({ x, y });
          }
        }
      }
      return { size, cells };
    } catch {
      return null;
    }
  }, [uri]);

  if (!matrix) return null;
  const pad = 4;
  const total = matrix.size + pad * 2;
  const center = total / 2;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[236px] rounded-[20px] bg-white p-3 shadow-sm">

      <svg
        viewBox={`0 0 ${total} ${total}`}
        shapeRendering="crispEdges"
        className="h-full w-full"
        role="img"
        aria-label="Wallet pairing QR code"
      >
        <rect width={total} height={total} fill="#FFFFFF" />
        {matrix.cells.map((c, idx) => (
          <rect
            key={idx}
            x={c.x + pad}
            y={c.y + pad}
            width={1}
            height={1}
            fill="#090B0E"
          />
        ))}
        {/* Minimalist center vault aperture badge */}
        <rect
          x={center - 2.6}
          y={center - 2.6}
          width={5.2}
          height={5.2}
          fill="#090B0E"
        />
        <rect
          x={center - 1.2}
          y={center - 1.2}
          width={2.6}
          height={2.4}
          fill="#FFFFFF"
        />
        <rect
          x={center + 0.2}
          y={center - 0.5}
          width={1.6}
          height={1.0}
          className="fill-signal"
        />
      </svg>
    </div>
  );
}

/* ============================================================================
 * 1. WALLET & NETWORK SHEET
 * ========================================================================== */

export function WalletSheet({
  open,
  onClose,
  onOpenPass,
  onOpenStudio,
}: {
  open: boolean;
  onClose: () => void;
  onOpenPass: () => void;
  onOpenStudio?: () => void;
}) {
  const { address, isConnected, chainId } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const watch = useWatchAsset();
  const [copied, setCopied] = useState(false);
  const [wcMode, setWcMode] = useState(false);
  const [wcUri, setWcUri] = useState<string>("");
  const [copiedUri, setCopiedUri] = useState(false);

  const wcConnector = useMemo(
    () => connectors.find((c) => c.id === "walletConnect" || c.type === "walletConnect"),
    [connectors],
  );

  // Reset QR subview when sheet closes or wallet finishes connecting
  useEffect(() => {
    if (!open || isConnected) {
      setWcMode(false);
    }
  }, [open, isConnected]);

  // Listen for live Reown / WalletConnect pairing URIs
  useEffect(() => {
    if (!wcConnector) return;

    const onMessage = (event: { type: string; data?: unknown }) => {
      if (event.type === "display_uri" && typeof event.data === "string") {
        setWcUri(event.data);
      }
    };

    const onDirectUri = (uri: string) => {
      if (typeof uri === "string" && uri) setWcUri(uri);
    };

    wcConnector.emitter.on("message", onMessage);

    let activeProvider: { on?: (ev: string, fn: (u: string) => void) => void; removeListener?: (ev: string, fn: (u: string) => void) => void } | null = null;
    wcConnector
      .getProvider()
      .then((p) => {
        const prov = p as typeof activeProvider;
        if (prov && typeof prov.on === "function") {
          activeProvider = prov;
          prov.on("display_uri", onDirectUri);
        }
      })
      .catch(() => null);

    return () => {
      wcConnector.emitter.off("message", onMessage);
      if (activeProvider && typeof activeProvider.removeListener === "function") {
        activeProvider.removeListener("display_uri", onDirectUri);
      }
    };
  }, [wcConnector]);

  const startWalletConnect = (connector: Connector, forceFresh = false) => {
    setWcMode(true);
    if (forceFresh) {
      setWcUri("");
    }
    if (!wcUri || forceFresh) {
      connect.reset();
      connect.mutate(
        { connector },
        {
          onSuccess: () => onClose(),
        },
      );
    }
  };

  const copyPairingUri = async () => {
    if (!wcUri) return;
    try {
      await navigator.clipboard.writeText(wcUri);
      setCopiedUri(true);
      window.setTimeout(() => setCopiedUri(false), 1600);
    } catch {
      // Clipboard unavailable
    }
  };

  const onElysium = isConnected && chainId === elysium.id;
  const me = (address ?? zeroAddress) as Hex;

  const hypeBal = useBalance({
    address: me,
    chainId: elysium.id,
    query: { enabled: open && onElysium, refetchInterval: 8_000 },
  });

  const tokenReads = useReadContracts({
    contracts: deployment
      ? [
          { address: deployment.usdc, abi: erc20Abi, functionName: "balanceOf", args: [me] },
          { address: deployment.pnth, abi: erc20Abi, functionName: "balanceOf", args: [me] },
          { address: deployment.staking, abi: pantheonStakingAbi, functionName: "accounts", args: [me] },
        ]
      : [],
    query: { enabled: open && onElysium && !!deployment, refetchInterval: 8_000 },
  });

  const usdc = tokenReads.data?.[0]?.result as bigint | undefined;
  const canon = tokenReads.data?.[1]?.result as bigint | undefined;
  const staked = tokenReads.data?.[2]?.result?.[0];
  const [manualVerify, setManualVerify] = useState<"idle" | "scan" | "confirm">("idle");

  const runLiveWalletVerify = async () => {
    if (!address) return;
    setManualVerify("scan");
    await Promise.allSettled([hypeBal.refetch(), tokenReads.refetch()]);
    window.setTimeout(() => {
      setManualVerify("confirm");
      window.setTimeout(() => setManualVerify("idle"), 900);
    }, 620);
  };

  const copyAddr = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable
    }
  };

  const encodedUri = wcUri ? encodeURIComponent(wcUri) : "";
  const mobileWallets = wcUri
    ? [
        { label: "MetaMask", href: `https://metamask.app.link/wc?uri=${encodedUri}` },
        { label: "Rainbow", href: `https://rnbwapp.com/wc?uri=${encodedUri}` },
        { label: "Trust", href: `https://link.trustwallet.com/wc?uri=${encodedUri}` },
        { label: "Zerion", href: `https://wallet.zerion.io/wc?uri=${encodedUri}` },
      ]
    : [];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={isConnected ? "Your Wallet" : wcMode ? "Scan or Open App" : "Connect Wallet"}
      subtitle="Elysium Testnet · Chain 99801"
    >
      {!isConnected ? (
        wcMode && wcConnector ? (
          <div className="space-y-4">
            {/* Sub-header controls */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setWcMode(false);
                  connect.reset();
                }}
                className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 text-[13.5px] font-bold text-stone transition-colors hover:text-ink"
              >
                <ArrowLeft className="h-4 w-4" />
                All Wallets
              </button>

              <button
                type="button"
                onClick={() => startWalletConnect(wcConnector, true)}
                className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 text-[13px] font-bold text-ink transition-opacity hover:opacity-70"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                New QR
              </button>
            </div>

            {/* Minimalist QR Matrix */}
            {wcUri ? (
              <MinimalistQrMatrix uri={wcUri} />
            ) : (
              <YoyoVerifyStage
                posture="scan"
                label="Preparing mobile pairing"
                sublabel="Elysium 99801"
              />
            )}

            <p className="text-center text-[13.5px] leading-snug text-stone">
              Scan with your phone camera or tap your wallet app below.
            </p>

            {/* Mobile-first one-tap wallet deep links */}
            {wcUri && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  {mobileWallets.map((w) => (
                    <a
                      key={w.label}
                      href={w.href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-[46px] items-center justify-between rounded-[14px] bg-surface px-3.5 py-2.5 text-[14px] font-bold text-ink transition-colors hover:bg-well"
                    >
                      <span>{w.label}</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-stone-light" />
                    </a>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={copyPairingUri}
                  className="btn-primary w-full"
                >
                  {copiedUri ? (
                    <>
                      <CheckIcon className="h-4 w-4 text-forest" />
                      Pairing Link Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy Pairing Link
                    </>
                  )}
                </button>
              </div>
            )}

            {connect.error && (
              <p className="rounded-2xl bg-crimson/12 px-3.5 py-3 text-[13.5px] font-semibold text-crimson">
                {plainReason(connect.error)}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {connect.isPending ? (
              <YoyoVerifyStage
                posture="scan"
                label="Verifying wallet connection"
                sublabel="Approve in your wallet app"
              />
            ) : (
              <p className="text-[15px] leading-relaxed text-stone">
                Connect a mobile or browser wallet to trade $CANON, stake for Vault rewards, and sign Round 5 ballots.
              </p>
            )}

            <div className="space-y-2.5">
              {connectors.map((c) => {
                const isWC = c.id === "walletConnect" || c.type === "walletConnect";
                const title = isWC
                  ? "Phone Wallet / QR"
                  : c.name === "Injected"
                    ? "Browser Wallet"
                    : c.name;
                const hint = isWC
                  ? "iPhone, Android, or QR scan"
                  : "MetaMask, Rabby, Coinbase";

                return (
                  <button
                    key={c.uid}
                    type="button"
                    disabled={connect.isPending && !isWC}
                    onClick={() => {
                      if (isWC) {
                        startWalletConnect(c);
                        return;
                      }
                      connect.mutate(
                        { connector: c },
                        {
                          onSuccess: () => onClose(),
                        },
                      );
                    }}
                    className="flex min-h-[58px] w-full cursor-pointer items-center justify-between rounded-[18px] bg-surface px-4 py-3 text-left text-ink transition-colors hover:bg-well"
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-well text-ink">
                        {isWC ? <Smartphone className="h-4.5 w-4.5" /> : <Wallet className="h-4.5 w-4.5" />}
                      </span>
                      <span>
                        <span className="block text-[15.5px] font-extrabold tracking-tight text-ink">
                          {title}
                        </span>
                        <span className="block text-[12.5px] font-medium text-stone">
                          {hint}
                        </span>
                      </span>
                    </span>
                    <span className="text-[13px] font-bold text-signal">
                      {isWC ? "Scan / App" : connect.isPending ? "Opening…" : "Connect"}
                    </span>
                  </button>
                );
              })}
            </div>

            {connect.error && (
              <p className="rounded-2xl bg-crimson/12 px-3.5 py-3 text-[13.5px] font-semibold text-crimson">
                {plainReason(connect.error)}
              </p>
            )}

            {onOpenStudio && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenStudio();
                }}
                className="flex min-h-[50px] w-full cursor-pointer items-center justify-between rounded-[16px] bg-surface px-4 py-3 text-left transition-colors hover:bg-well"
              >
                <span className="text-[14px] font-bold text-ink">
                  Launch Your $CANON · Guided
                </span>
                <span className="text-[13px] font-bold text-signal">Open →</span>
              </button>
            )}

            <div className="pt-4">
              <p className="ui-label mb-2">Appearance</p>
              <ThemeSwitcher className="w-full justify-between" />
            </div>
          </div>
        )
      ) : (
        <div className="space-y-5">
          {/* Live YOYO Liquid Glass verification stage while checking 0x balances or re-verifying */}
          {(manualVerify !== "idle" ||
            switchChain.isPending ||
            (onElysium && (hypeBal.isLoading || tokenReads.isLoading))) && (
            <YoyoVerifyStage
              posture={manualVerify === "confirm" ? "confirm" : "scan"}
              address={me}
              label={
                manualVerify === "confirm"
                  ? "Wallet address verified"
                  : switchChain.isPending
                    ? "Switching to Elysium 99801"
                    : "Verifying your 0x address"
              }
              sublabel={manualVerify === "confirm" ? "Balances synced" : "Elysium 99801"}
            />
          )}

          {/* Identity row */}
          <div className="flex items-center justify-between gap-3 rounded-[18px] bg-surface p-4">
            <div className="flex min-w-0 items-center gap-3">
              <CanonWalletSigil address={me} size={48} />
              <div className="min-w-0">
                <p className="num truncate text-[15.5px] font-bold text-ink">{short(me)}</p>
                <p className="mt-0.5 text-[12.5px] text-stone">
                  {onElysium ? "Connected to Elysium Testnet" : "Wrong network selected"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {onElysium && (
                <button
                  type="button"
                  onClick={runLiveWalletVerify}
                  disabled={manualVerify === "scan"}
                  className="inline-flex h-11 min-w-[44px] cursor-pointer items-center justify-center rounded-xl bg-well px-3 text-[12.5px] font-bold text-ink transition-colors hover:bg-well-hover disabled:opacity-50"
                  aria-label="Verify wallet address on Elysium"
                >
                  <RefreshCw className={`h-4 w-4 ${manualVerify === "scan" ? "animate-spin text-signal" : ""}`} />
                </button>
              )}
              <button
                type="button"
                onClick={copyAddr}
                className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-well text-ink transition-colors hover:bg-well-hover"
                aria-label="Copy wallet address"
              >
                {copied ? <CheckIcon className="h-4.5 w-4.5 text-forest" /> : <Copy className="h-4.5 w-4.5" />}
              </button>
            </div>
          </div>

          {!onElysium ? (
            <button
              type="button"
              onClick={() => {
                void ensureElysiumNetwork((args) => switchChain.mutateAsync(args)).catch(() => null);
              }}
              className="btn-signal w-full"
            >
              Switch to Elysium Testnet
            </button>
          ) : (
            <>
              {/* Balances */}
              <div className="divide-y divide-line rounded-[20px] bg-surface px-4">
                <div className="flex items-center justify-between py-3.5">
                  <span className="text-[14px] font-semibold text-stone">Test HYPE (Gas)</span>
                  <span className="num text-[15px] font-bold text-ink">
                    {fmt(hypeBal.data?.value)} HYPE
                  </span>
                </div>
                <div className="flex items-center justify-between py-3.5">
                  <span className="text-[14px] font-semibold text-stone">Test USDC</span>
                  <span className="num text-[15px] font-bold text-ink">{fmt(usdc, 6)} USDC</span>
                </div>
                <div className="flex items-center justify-between py-3.5">
                  <span className="text-[14px] font-semibold text-stone">$CANON in Wallet</span>
                  <span className="num text-[15px] font-bold text-ink">{fmt(canon)}</span>
                </div>
                <div className="flex items-center justify-between py-3.5">
                  <span className="text-[14px] font-semibold text-stone">$CANON Staked</span>
                  <span className="num text-[15px] font-bold text-forest">{fmt(staked)}</span>
                </div>
              </div>

              {/* Quick actions */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {deployment && (
                  <button
                    type="button"
                    disabled={watch.isPending || watch.isSuccess}
                    onClick={() => {
                      if (!deployment) return;
                      watch.mutate({
                        type: "ERC20",
                        options: { address: deployment.pnth, symbol: "CANON", decimals: 18 },
                      });
                    }}
                    className="btn-secondary w-full"
                  >
                    <Plus className="h-4 w-4" />
                    {watch.isSuccess ? "Token Added" : "Add $CANON to Wallet"}
                  </button>
                )}
                <a
                  href={FAUCET_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary w-full"
                >
                  Test HYPE Faucet
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenPass();
                }}
                className="flex min-h-[52px] w-full cursor-pointer items-center justify-between rounded-[18px] bg-well px-4 py-3 text-left text-ink transition-colors hover:bg-well-hover"
              >
                <span className="flex items-center gap-2.5 text-[14.5px] font-bold">
                  <Sparkles className="h-4.5 w-4.5 text-signal" />
                  HYPE Pass · Up to 1.25× Rewards
                </span>
                <span className="text-[13px] font-bold text-signal">Open →</span>
              </button>

              {onOpenStudio && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenStudio();
                  }}
                  className="flex min-h-[50px] w-full cursor-pointer items-center justify-between rounded-[18px] bg-surface px-4 py-3 text-left transition-colors hover:bg-well"
                >
                  <span className="text-[14px] font-bold text-ink">
                    Launch Your $CANON · Guided
                  </span>
                  <span className="text-[13px] font-bold text-signal">Open →</span>
                </button>
              )}
            </>
          )}

          <div className="pt-4">
            <p className="ui-label mb-2">Appearance</p>
            <ThemeSwitcher className="w-full justify-between" />
          </div>

          <button
            type="button"
            onClick={() => {
              disconnect.mutate();
              onClose();
            }}
            className="inline-flex min-h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl text-[14px] font-bold text-stone transition-colors hover:bg-well hover:text-ink"
          >
            <LogOut className="h-4 w-4" />
            Disconnect Wallet
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

/* ============================================================================
 * 2. HYPE PASS LINKING SHEET
 * ========================================================================== */

const PASS_TIERS = [
  { tier: 1, need: "10 HYPE", boost: "1.10×", votes: 1 },
  { tier: 2, need: "100 HYPE · 30d account", boost: "1.20×", votes: 2 },
  { tier: 3, need: "1,000 HYPE · 90d account", boost: "1.25×", votes: 3 },
];

const PASS_MESSAGES: Record<string, string> = {
  SCORE_BELOW_10: "Less than 10 HYPE counted. Staked HYPE counts in full; held HYPE counts half.",
  SCORE_BELOW_100: "Under 100 HYPE counted for Tier 2.",
  SCORE_BELOW_1000: "Under 1,000 HYPE counted for Tier 3.",
  ACCOUNT_AGE_BELOW_30D: "Your Hyperliquid account is under 30 days old.",
  ACCOUNT_AGE_BELOW_90D: "Your Hyperliquid account is under 90 days old.",
  NO_HYPERCORE_HISTORY: "This wallet has not traded or held on Hyperliquid yet.",
  PARTIAL_EVM_READ: "Part of your HyperEVM balance could not be read right now. Try again shortly.",
  AGENT_WALLET: "That is an API agent wallet. Enter the main wallet that holds your HYPE.",
  NOT_A_SIGNING_ACCOUNT: "Vaults and sub-accounts cannot sign directly. Use your main wallet.",
  MULTISIG_UNSUPPORTED: "Multi-signature Hyperliquid accounts are not supported yet.",
  HL_ALREADY_LINKED: "That Hyperliquid wallet is already linked to another Elysium wallet.",
  ACCOUNT_ALREADY_LINKED: "This Elysium wallet is already linked to a Hyperliquid wallet.",
  REBIND_COOLDOWN: "Recently unlinked wallets wait 7 days before linking again.",
  RATE_LIMITED: "Too many checks in a row. Wait a minute and try again.",
  CHALLENGE_EXPIRED: "That request expired after 15 minutes. Start a fresh check.",
  CHALLENGE_USED: "That request was already used. Start a fresh check.",
  CHALLENGE_NOT_FOUND: "Request not found. Start again.",
  BAD_HL_SIGNATURE: "The signature did not match that Hyperliquid wallet.",
  BAD_ELYSIUM_SIGNATURE: "The signature did not match your Elysium wallet.",
  INVALID_ADDRESS: "Enter a valid 0x wallet address.",
  HTTP_500: "The HYPE Pass verifier is offline on testnet right now. Try again soon.",
  HTTP_502: "The HYPE Pass verifier is offline on testnet right now. Try again soon.",
  HTTP_503: "The HYPE Pass verifier is offline right now. Existing on-chain passes still work in full.",
  HTTP_504: "The HYPE Pass verifier took too long to answer. Try again in a minute.",
};

const passSay = (code: string) => PASS_MESSAGES[code] ?? `HYPE Pass check returned: ${code}`;

type TypedDataPayload = {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
};

type PassChallenge = {
  nonce: Hex;
  typedData: TypedDataPayload;
  e: Hex;
  h: Hex;
  hlSig?: Hex;
  elySig?: Hex;
};

async function passApi<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    `/api/passport${path}`,
    body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {},
  );
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status >= 500 && !json.error) throw new Error(`HTTP_${res.status}`);
  if (!res.ok) throw new Error(json.error ?? `HTTP_${res.status}`);
  return json as T;
}

export function HypePassSheet({
  open,
  onClose,
  onOpenWallet,
}: {
  open: boolean;
  onClose: () => void;
  onOpenWallet: () => void;
}) {
  const { address, isConnected, chainId } = useConnection();
  const onChain = isConnected && chainId === elysium.id;
  const me = (address ?? zeroAddress) as Hex;
  const now = useChainNow();
  const qc = useQueryClient();
  const sign = useSignTypedData();
  const tx = useTx();

  const [hl, setHl] = useState("");
  const [ch, setCh] = useState<PassChallenge | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyPosture, setBusyPosture] = useState<"scan" | "sign" | "confirm">("scan");
  const [err, setErr] = useState<string | null>(null);
  const [zeroReasons, setZeroReasons] = useState<string[] | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const reads = useReadContracts({
    contracts: deployment
      ? [
          { address: deployment.passportRegistry, abi: hypePassportRegistryAbi, functionName: "passportOf", args: [me] },
          { address: deployment.passportRegistry, abi: hypePassportRegistryAbi, functionName: "isValid", args: [me] },
          { address: deployment.passportRegistry, abi: hypePassportRegistryAbi, functionName: "multiplierOf", args: [me] },
          { address: deployment.staking, abi: pantheonStakingAbi, functionName: "accounts", args: [me] },
          { address: deployment.staking, abi: pantheonStakingAbi, functionName: "workingOf", args: [me] },
        ]
      : [],
    query: { enabled: open && onChain && !!deployment, refetchInterval: 8_000 },
  });

  const passport = reads.data?.[0]?.result;
  const valid = reads.data?.[1]?.result ?? false;
  const mult = Number(reads.data?.[2]?.result ?? 10n ** 18n) / 1e18;
  const storedWorking = reads.data?.[3]?.result?.[2] ?? 0n;
  const freshWorking = reads.data?.[4]?.result ?? 0n;
  const boostWaiting = freshWorking !== storedWorking && storedWorking > 0n;

  const sameWallet = ch ? ch.e.toLowerCase() === ch.h.toLowerCase() : false;
  const isCurrent = (target: Hex) => address?.toLowerCase() === target.toLowerCase();

  const startLink = async () => {
    setErr(null);
    setZeroReasons(null);
    if (!isAddress(hl)) {
      setErr(passSay("INVALID_ADDRESS"));
      return;
    }
    setBusyPosture("scan");
    setBusy("Verifying 0x address…");
    startAddressVerify({
      posture: "scan",
      address: hl,
      label: "Verifying Hyperliquid 0x",
      sublabel: "Preparing signature check",
    });
    try {
      const c = await passApi<{ nonce: Hex; typedData: TypedDataPayload }>("/challenge", {
        elysiumAccount: me,
        hyperliquidAccount: hl,
      });
      setCh({ nonce: c.nonce, typedData: c.typedData, e: me, h: hl as Hex });
      finishAddressVerify({
        ok: true,
        address: hl,
        label: "0x address ready to sign",
        sublabel: "Zero gas proof",
        holdMs: 800,
      });
    } catch (e) {
      const msg = passSay((e as Error).message);
      setErr(msg);
      finishAddressVerify({
        ok: false,
        address: hl,
        label: "Address check paused",
        sublabel: "See details below",
        holdMs: 900,
      });
    } finally {
      setBusy(null);
    }
  };

  const signStep = async (who: "h" | "e") => {
    if (!ch) return;
    const signerTarget = who === "h" ? ch.h : ch.e;
    setErr(null);
    setBusyPosture("sign");
    setBusy("Waiting for wallet signature…");
    startAddressVerify({
      posture: "sign",
      address: signerTarget,
      label: "Waiting for wallet signature",
      sublabel: "Free off-chain proof",
    });
    try {
      const td = ch.typedData;
      const message = {
        ...td.message,
        deadline: BigInt(String(td.message.deadline)),
        chainId: BigInt(String(td.message.chainId)),
      };
      const sig = await sign.mutateAsync({
        account: signerTarget,
        domain: td.domain,
        types: td.types,
        primaryType: td.primaryType,
        message,
      } as Parameters<typeof sign.mutateAsync>[0]);
      setCh(
        who === "h"
          ? { ...ch, hlSig: sig, ...(sameWallet ? { elySig: sig } : {}) }
          : { ...ch, elySig: sig },
      );
      finishAddressVerify({
        ok: true,
        address: signerTarget,
        label: "Signature verified",
        sublabel: "Ready for next step",
        holdMs: 800,
      });
    } catch (e) {
      setErr(/rejected|denied/i.test(String(e)) ? "You cancelled it in your wallet." : plainReason(e));
      finishAddressVerify({
        ok: false,
        address: signerTarget,
        label: "Signature cancelled",
        sublabel: "Try signing again",
        holdMs: 850,
      });
    } finally {
      setBusy(null);
    }
  };

  const verifyPass = async () => {
    if (!ch?.hlSig) return;
    const targetAddr = ch.h;
    setErr(null);
    setBusyPosture("scan");
    setBusy("Scanning HYPE balance on Hyperliquid…");
    startAddressVerify({
      posture: "scan",
      address: targetAddr,
      label: "Scanning HYPE balance",
      sublabel: "Hyperliquid + HyperEVM",
    });
    try {
      const res = await passApi<{ tier: number; reasons?: string[] }>("/verify", {
        nonce: ch.nonce,
        hlSignature: ch.hlSig,
        ...(sameWallet ? {} : { elysiumSignature: ch.elySig }),
        relay: true,
      });
      setCh(null);
      if (res.tier === 0) {
        setZeroReasons(res.reasons ?? []);
        finishAddressVerify({
          ok: false,
          address: targetAddr,
          label: "Below Tier 1 threshold",
          sublabel: "Needs 10 counted HYPE",
          holdMs: 1100,
        });
      } else {
        setBusyPosture("confirm");
        setBusy(`Tier ${res.tier} HYPE Pass verified!`);
        await qc.invalidateQueries();
        finishAddressVerify({
          ok: true,
          address: targetAddr,
          label: `Tier ${res.tier} Pass verified`,
          sublabel: "Minted on Elysium",
          holdMs: 1200,
        });
        await new Promise((r) => window.setTimeout(r, 750));
      }
    } catch (e) {
      setErr(passSay((e as Error).message));
      finishAddressVerify({
        ok: false,
        address: targetAddr,
        label: "Verification could not finish",
        sublabel: "Check message below",
        holdMs: 950,
      });
    } finally {
      setBusy(null);
    }
  };

  const refreshPass = async () => {
    setErr(null);
    setBusyPosture("scan");
    setBusy("Rechecking HYPE balance…");
    startAddressVerify({
      posture: "scan",
      address: me,
      label: "Rechecking HYPE balance",
      sublabel: "Elysium 99801",
    });
    try {
      await passApi("/refresh", { elysiumAccount: me });
      setBusyPosture("confirm");
      setBusy("HYPE Pass verified!");
      await qc.invalidateQueries();
      finishAddressVerify({
        ok: true,
        address: me,
        label: "HYPE Pass refreshed",
        sublabel: "Tier synced",
        holdMs: 1050,
      });
      await new Promise((r) => window.setTimeout(r, 650));
    } catch (e) {
      setErr(passSay((e as Error).message));
      finishAddressVerify({
        ok: false,
        address: me,
        label: "Refresh paused",
        sublabel: "See details below",
        holdMs: 900,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="HYPE Pass"
      subtitle="Prove you hold HYPE with a free signature. Nothing leaves your wallet."
    >
      <div className="space-y-5">
        {onChain && (busy || ch) && (
          <YoyoVerifyStage
            posture={
              busy
                ? busyPosture
                : ch && ch.hlSig && (sameWallet || ch.elySig)
                  ? "confirm"
                  : "scan"
            }
            address={ch ? (!ch.hlSig ? ch.h : !sameWallet && !ch.elySig ? ch.e : ch.h) : hl || me}
            label={
              busy
                ? busy
                : ch && !ch.hlSig
                  ? "Sign to verify Hyperliquid 0x"
                  : ch && !sameWallet && !ch.elySig
                    ? "Sign to link Elysium 0x"
                    : "Signatures verified · Issue Pass"
            }
            sublabel={
              busyPosture === "sign"
                ? "Zero gas · Wallet prompt open"
                : ch
                  ? sameWallet
                    ? "Single-wallet match"
                    : "Two-wallet link"
                  : "Hyperliquid HYPE check"
            }
          />
        )}
        {!onChain ? (
          <div className="rounded-[20px] bg-surface p-5">
            <p className="text-[15px] leading-relaxed text-stone">
              Connect your Elysium wallet first to check or link your Hyperliquid HYPE balance.
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenWallet();
              }}
              className="btn-primary mt-4 w-full"
            >
              Connect Wallet
            </button>
          </div>
        ) : valid && passport && deployment ? (
          <div className="space-y-4 rounded-[18px] bg-surface p-5">
            <div className="flex items-center gap-4">
              <CanonWalletSigil address={me} size={58} />
              <div>
                <p className="ui-label">Active Pass</p>
                <p className="heading-section mt-0.5 text-[26px] text-ink">
                  Tier {passport.tier}
                </p>
                <p className="mt-0.5 text-[13px] text-stone">
                  Renews in {until(Math.max(0, Number(passport.expiry) - now))}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="canon-well p-3.5">
                <p className="ui-label text-[10.5px]">Staking Boost</p>
                <p className="num mt-1 text-[20px] font-bold text-ink">{mult.toFixed(2)}×</p>
              </div>
              <div className="canon-well p-3.5">
                <p className="ui-label text-[10.5px]">Extra Ballot Votes</p>
                <p className="num mt-1 text-[20px] font-bold text-forest">
                  +{PASS_TIERS.find((t) => t.tier === passport.tier)?.votes ?? 0}
                </p>
              </div>
            </div>

            {boostWaiting && (
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-signal/12 px-4 py-3 text-[13.5px] text-ink">
                <span className="font-semibold">Apply this boost to your active stake</span>
                <button
                  type="button"
                  disabled={!!tx.busy}
                  onClick={() => {
                    if (!deployment) return;
                    tx.run("Applying boost", [
                      {
                        address: deployment.staking,
                        abi: pantheonStakingAbi,
                        functionName: "poke",
                        args: [[me]],
                      } as const,
                    ]);
                  }}
                  className="btn-signal min-h-[38px] px-3.5 text-[13px]"
                >
                  {tx.busy ?? "Apply"}
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={!!busy}
                onClick={refreshPass}
                className="btn-secondary flex-1"
              >
                <RefreshCw className="h-4 w-4" />
                {busy ?? "Recheck HYPE"}
              </button>
              {!confirmUnlink ? (
                <button
                  type="button"
                  onClick={() => setConfirmUnlink(true)}
                  className="btn-secondary px-4 text-stone"
                >
                  Unlink
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!!tx.busy}
                  onClick={() => {
                    if (!deployment) return;
                    tx.run("Unlinking pass", [
                      {
                        address: deployment.passportRegistry,
                        abi: hypePassportRegistryAbi,
                        functionName: "unlink",
                      } as const,
                    ]);
                  }}
                  className="btn-secondary px-4 text-crimson"
                >
                  {tx.busy ?? "Confirm Unlink"}
                </button>
              )}
            </div>
            <TxFeedback error={tx.error} lastTx={tx.lastTx} />
          </div>
        ) : zeroReasons ? (
          <div className="space-y-3 rounded-[20px] bg-surface p-5">
            <p className="heading-card text-[17px] text-ink">Below Tier 1 right now</p>
            <p className="text-[14px] leading-relaxed text-stone">
              That wallet does not reach 10 counted HYPE yet, so nothing was linked on-chain:
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] text-ink">
              {zeroReasons.map((r) => (
                <li key={r}>{passSay(r)}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setZeroReasons(null)}
              className="btn-secondary mt-2 w-full"
            >
              Try Another Wallet
            </button>
          </div>
        ) : !ch ? (
          <div className="space-y-4 rounded-[20px] bg-surface p-5">
            <div className="flex items-center justify-between text-[13.5px]">
              <span className="font-semibold text-stone">Elysium Wallet</span>
              <span className="num font-bold text-ink">{short(me)}</span>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="hl-wallet-input" className="ui-label">
                  Hyperliquid Wallet
                </label>
                <button
                  type="button"
                  onClick={() => setHl(me)}
                  className="min-h-[36px] cursor-pointer text-[13px] font-bold text-signal"
                >
                  Use same wallet
                </button>
              </div>
              <input
                id="hl-wallet-input"
                value={hl}
                onChange={(e) => setHl(e.target.value.trim())}
                placeholder="0x…"
                spellCheck={false}
                className="canon-input num mt-1.5 min-h-[50px] w-full px-3.5 text-[14.5px] font-semibold"
              />
              {hl.length > 0 && (
                <p
                  className={`mt-1.5 text-[12.5px] font-semibold ${
                    isAddress(hl) ? "text-forest" : "text-stone"
                  }`}
                >
                  {isAddress(hl)
                    ? "Valid 0x address · Ready for YOYO balance check"
                    : "Enter full 42-character 0x wallet address"}
                </p>
              )}
              <p className="mt-2 text-[12.5px] leading-relaxed text-stone">
                Only your tier number and a private hash go on-chain—never your Hyperliquid address or balance.
              </p>
            </div>

            <button
              type="button"
              disabled={!hl || !!busy}
              onClick={startLink}
              className="btn-signal w-full"
            >
              {busy ?? "Check My HYPE"}
            </button>
          </div>
        ) : (
          <div className="space-y-3 rounded-[20px] bg-surface p-5">
            <div className="flex items-center justify-between gap-3 py-1">
              <div>
                <p className="text-[14.5px] font-bold text-ink">
                  1. Sign with Hyperliquid {short(ch.h)}
                </p>
                <p className="text-[12.5px] text-stone">
                  {isCurrent(ch.h) ? "Free wallet signature, zero gas." : `Switch wallet to ${short(ch.h)}`}
                </p>
              </div>
              {ch.hlSig ? (
                <span className="text-[13px] font-bold text-forest">Signed ✓</span>
              ) : (
                <button
                  type="button"
                  disabled={!isCurrent(ch.h) || !!busy}
                  onClick={() => signStep("h")}
                  className="btn-primary min-h-[42px] px-4 text-[13.5px]"
                >
                  Sign
                </button>
              )}
            </div>

            {!sameWallet && (
              <div className="flex items-center justify-between gap-3 pt-3">
                <div>
                  <p className="text-[14.5px] font-bold text-ink">
                    2. Sign with Elysium {short(ch.e)}
                  </p>
                  <p className="text-[12.5px] text-stone">
                    {isCurrent(ch.e) ? "Confirms both wallets agree." : `Switch back to ${short(ch.e)}`}
                  </p>
                </div>
                {ch.elySig ? (
                  <span className="text-[13px] font-bold text-forest">Signed ✓</span>
                ) : (
                  <button
                    type="button"
                    disabled={!ch.hlSig || !isCurrent(ch.e) || !!busy}
                    onClick={() => signStep("e")}
                    className="btn-primary min-h-[42px] px-4 text-[13.5px]"
                  >
                    Sign
                  </button>
                )}
              </div>
            )}

            <div className="pt-2">
              <button
                type="button"
                disabled={!ch.hlSig || (!sameWallet && !ch.elySig) || !!busy}
                onClick={verifyPass}
                className="btn-signal w-full"
              >
                {busy ?? "Issue My HYPE Pass"}
              </button>
              <button
                type="button"
                onClick={() => setCh(null)}
                className="mt-2 min-h-[42px] w-full cursor-pointer text-[13.5px] font-bold text-stone hover:text-ink"
              >
                Start Over
              </button>
            </div>
          </div>
        )}

        {err && (
          <p className="rounded-2xl bg-crimson/12 px-3.5 py-3 text-[13.5px] text-crimson">{err}</p>
        )}

        {/* Tier table */}
        <div className="rounded-[20px] bg-surface p-4">
          <p className="ui-label">Pass Tiers</p>
          <div className="mt-2.5 divide-y divide-line">
            {PASS_TIERS.map((t) => (
              <div key={t.tier} className="flex items-center justify-between py-2.5 text-[13.5px]">
                <div>
                  <span className="font-bold text-ink">Tier {t.tier}</span>
                  <span className="ml-2 text-stone">{t.need}</span>
                </div>
                <span className="num font-bold text-ink">
                  {t.boost} · +{t.votes}v
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-stone">
            Counted HYPE = 100% of staked HYPE + 50% of held HYPE.
          </p>
        </div>
      </div>
    </BottomSheet>
  );
}

/* ============================================================================
 * 3. LENS COIN PROOF REPORT SHEET & 4. DISPUTE SHEET
 * ========================================================================== */

const CHECK_LABELS: Record<Check, string> = {
  bundle: "Launch Bundle (First 30s)",
  wash: "Wash Loops (Back-and-Forth)",
  concentration: "Top Holder Share",
};

export function verdictTone(v: Verdict): { text: string; colorClass: string } {
  if (v === "CLEAN") return { text: "Clean", colorClass: "text-forest" };
  if (v === "WATCH") return { text: "Watch", colorClass: "text-amber-tone" };
  if (v === "FLAG") return { text: "Flagged", colorClass: "text-crimson" };
  return { text: "Early", colorClass: "text-stone" };
}

export function CoinReportSheet({
  open,
  token,
  delphi,
  currentRound,
  onClose,
  onChallenge,
}: {
  open: boolean;
  token: string | null;
  delphi: Delphi;
  currentRound: number | null;
  onClose: () => void;
  onChallenge: (token: string, symbol: string) => void;
}) {
  if (!token) return null;
  const key = token.toLowerCase();
  const row = delphi.coins.find((c) => c.token.toLowerCase() === key);
  const detail = delphi.explained[key];
  const note = basketNote(token, currentRound);
  const symbol = row?.symbol ?? short(token);
  const verdict = row?.verdict ?? detail?.report.verdict ?? "NOT_ENOUGH_DATA";
  const tone = verdictTone(verdict);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={`${symbol} · Lens Check`}
      subtitle={`${VERDICT[verdict]} · Scanned ${delphi.scannedAt ? when(delphi.scannedAt) : "on Elysium"}`}
      maxWidthClass="lg:max-w-xl"
    >
      <div className="space-y-5">
        {/* Verdict & plain-English summary */}
        <div className="rounded-[20px] bg-surface p-5">
          <p className={`text-[13px] font-extrabold uppercase tracking-wider ${tone.colorClass}`}>
            {tone.text} Verdict
          </p>
          <p className="heading-card mt-1.5 text-[18px] text-ink">
            {detail?.explanation.headline
              ? headline(detail.explanation.headline)
              : row?.headline
                ? headline(row.headline)
                : `${symbol} passed standard on-chain trade checks.`}
          </p>
          {detail?.explanation.summary && (
            <p className="mt-2 text-[14.5px] leading-relaxed text-stone">
              {detail.explanation.summary}
            </p>
          )}

          {note && (
            <p className="mt-3 pt-3 text-[13.5px] font-semibold text-ink">
              {note.in
                ? `In The Vault right now (Round ${note.round}).`
                : note.was
                  ? `Previously in Round ${note.was}; left out of Round ${note.round}${note.why ? ` (${note.why})` : ""}.`
                  : note.why
                    ? `Kept out of Round ${note.round}: ${note.why}`
                    : `Not in Round ${note.round} top 10.`}
            </p>
          )}
        </div>

        {/* Unboxed tabular stats */}
        {row && (
          <div className="grid grid-cols-3 gap-2.5">
            <div className="canon-well p-3.5">
              <p className="ui-label text-[10.5px]">Trades</p>
              <p className="num mt-1 text-[18px] font-bold text-ink">{row.trades}</p>
            </div>
            <div className="canon-well p-3.5">
              <p className="ui-label text-[10.5px]">Traders</p>
              <p className="num mt-1 text-[18px] font-bold text-ink">{row.wallets}</p>
            </div>
            <div className="canon-well p-3.5">
              <p className="ui-label text-[10.5px]">Holders</p>
              <p className="num mt-1 text-[18px] font-bold text-ink">{row.holders}</p>
            </div>
          </div>
        )}

        {/* Three pattern detectors */}
        {detail?.report && (
          <div className="rounded-[20px] bg-surface p-4">
            <p className="ui-label">Pattern Checks</p>
            <div className="mt-2 divide-y divide-line">
              {(["bundle", "wash", "concentration"] as const).map((chk) => {
                const state = detail.report.checks[chk];
                return (
                  <div key={chk} className="flex items-center justify-between py-3 text-[14px]">
                    <span className="font-semibold text-ink">{CHECK_LABELS[chk]}</span>
                    <span
                      className={`font-bold ${
                        state === "clear"
                          ? "text-forest"
                          : state === "found"
                            ? "text-crimson"
                            : "text-stone"
                      }`}
                    >
                      {state === "clear" ? "Clear" : state === "found" ? "Pattern Found" : "Too Early"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Explorer proof & dispute actions */}
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <a
            href={explorer("token", token)}
            target="_blank"
            rel="noreferrer"
            className="btn-primary flex-1"
          >
            View Coin on Explorer
            <ArrowUpRight className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={() => onChallenge(token, symbol)}
            className="btn-secondary flex-1"
          >
            Challenge This Check
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

export function DisputeSheet({
  open,
  token,
  symbol,
  onClose,
}: {
  open: boolean;
  token: string;
  symbol?: string;
  onClose: () => void;
}) {
  const [coinAddr, setCoinAddr] = useState(token);
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const activeToken = token || coinAddr;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!isAddress(activeToken)) {
      setErr("Enter a valid 0x coin address.");
      return;
    }
    if (message.trim().length < 12) {
      setErr("Write at least one clear sentence with transaction hashes or context.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/delphi/v1/dispute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: activeToken,
          message: message.trim(),
          contact: contact.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not submit right now.");
      setSent(true);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        setSent(false);
        setErr(null);
        onClose();
      }}
      title={symbol ? `Challenge ${symbol} Check` : "Challenge a Lens Check"}
      subtitle="The Lens reports transaction patterns, never personal intent. Share proof if a pattern was misread."
    >
      {sent ? (
        <div className="space-y-4 rounded-[20px] bg-surface p-5">
          <p className="heading-card text-[18px] text-forest">Challenge Recorded</p>
          <p className="text-[14.5px] leading-relaxed text-stone">
            Your note for <span className="num font-bold text-ink">{short(activeToken)}</span> has been logged for review against the explorer transactions.
          </p>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setMessage("");
              onClose();
            }}
            className="btn-primary w-full"
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {!token && (
            <div>
              <label htmlFor="dispute-token" className="ui-label">
                Coin Address
              </label>
              <input
                id="dispute-token"
                value={coinAddr}
                onChange={(e) => setCoinAddr(e.target.value.trim())}
                placeholder="0x…"
                spellCheck={false}
                className="canon-input num mt-1.5 min-h-[48px] w-full px-3.5 text-[14px]"
              />
            </div>
          )}

          <div>
            <label htmlFor="dispute-msg" className="ui-label">
              What did the check get wrong?
            </label>
            <textarea
              id="dispute-msg"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Include transaction hashes or wallet links showing why those trades were independent…"
              className="canon-input mt-1.5 w-full p-3.5 text-[14.5px] leading-relaxed"
            />
          </div>

          <div>
            <label htmlFor="dispute-contact" className="ui-label">
              Where to reply (Optional)
            </label>
            <input
              id="dispute-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="@handle or email"
              className="canon-input mt-1.5 min-h-[48px] w-full px-3.5 text-[14.5px]"
            />
          </div>

          {sending && (
            <YoyoVerifyStage
              posture="scan"
              address={activeToken}
              label="Verifying 0x coin record"
              sublabel="Logging challenge"
            />
          )}

          {err && (
            <p className="rounded-2xl bg-crimson/12 px-3.5 py-3 text-[13.5px] text-crimson">{err}</p>
          )}

          <button type="submit" disabled={sending} className="btn-signal w-full">
            {sending ? "Verifying & Sending…" : "Submit Challenge"}
          </button>
        </form>
      )}
    </BottomSheet>
  );
}

/* ============================================================================
 * 5. FEE LOCK TOKEN LAUNCHER SHEET
 * ========================================================================== */

const PAY = 0;
const BURN = 1;
const INDEX = 2;
type FeeLeg = { job: number; bps: number; target: Hex };
type SellRule = "burn" | "half" | "pay";
type BuyRule = "split" | "basket" | "pay";

const launchPausedAbi = [
  { type: "function", name: "paused", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
] as const;

function makeSellLegs(rule: SellRule, wallet: Hex): FeeLeg[] {
  if (rule === "burn") return [{ job: BURN, bps: 10_000, target: zeroAddress }];
  if (rule === "half") {
    return [
      { job: BURN, bps: 5_000, target: zeroAddress },
      { job: PAY, bps: 5_000, target: wallet },
    ];
  }
  return [{ job: PAY, bps: 10_000, target: wallet }];
}

function makeBuyLegs(rule: BuyRule, wallet: Hex, vaultAddr: Hex): FeeLeg[] {
  if (rule === "pay") return [{ job: PAY, bps: 10_000, target: wallet }];
  if (rule === "split") {
    return [
      { job: PAY, bps: 5_000, target: wallet },
      { job: INDEX, bps: 5_000, target: vaultAddr },
    ];
  }
  return [{ job: INDEX, bps: 10_000, target: vaultAddr }];
}

function randomSalt(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function FeeLockSheet({
  open,
  onClose,
  onOpenWallet,
}: {
  open: boolean;
  onClose: () => void;
  onOpenWallet: () => void;
}) {
  const { address, isConnected, chainId } = useConnection();
  const onChain = isConnected && chainId === elysium.id;
  const client = usePublicClient({ chainId: elysium.id });
  const tx = useTx();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [sellRule, setSellRule] = useState<SellRule>("burn");
  const [buyRule, setBuyRule] = useState<BuyRule>("split");
  const [payTo, setPayTo] = useState("");
  const [launched, setLaunched] = useState<{ symbol: string; token: Hex; router: Hex; tx: Hex } | null>(null);

  const pausedRead = useReadContract({
    address: deployment?.launchpad,
    abi: launchPausedAbi,
    functionName: "paused",
    chainId: elysium.id,
    query: { enabled: open && !!deployment, refetchInterval: 30_000 },
  });
  const ascendPaused = pausedRead.data === true;

  const deployedQuery = useQuery({
    queryKey: ["feelock-coins", deployment?.covenantFactory],
    enabled: open && !!client && !!deployment,
    refetchInterval: 30_000,
    queryFn: async () => {
      const logs = await client!.getContractEvents({
        address: deployment!.covenantFactory,
        abi: covenantFactoryAbi,
        eventName: "RouterDeployed",
        fromBlock: deployedFrom,
        toBlock: "latest",
      });
      return logs
        .map((l) => ({
          token: l.args.token as Hex,
          router: l.args.router as Hex,
          launched: !!l.args.launched,
        }))
        .reverse();
    },
  });

  const deployedList = deployedQuery.data ?? [];
  const deployedSyms = useReadContracts({
    contracts: deployedList.map((x) => ({ address: x.token, abi: erc20Abi, functionName: "symbol" }) as const),
    query: { enabled: open && deployedList.length > 0 },
  });

  const payoutWallet = (payTo.trim() || address || "") as Hex;
  const needsWallet = sellRule !== "burn" || buyRule !== "basket";

  const validationIssue =
    name.trim().length === 0
      ? "Enter a coin name"
      : name.trim().length > 32
        ? "Name must be 32 characters or fewer"
        : !/^[A-Z0-9]{1,10}$/.test(symbol)
          ? "Ticker must be 1–10 letters or numbers"
          : needsWallet && !isAddress(payoutWallet)
            ? "Enter a valid payout wallet"
            : null;

  const handleLaunch = async () => {
    if (!deployment) return;
    const receipts = await tx.run("Launching Fee Lock coin", [
      {
        address: deployment.covenantFactory,
        abi: covenantFactoryAbi,
        functionName: "launch",
        args: [
          name.trim(),
          symbol,
          deployment.usdc,
          randomSalt(),
          makeSellLegs(sellRule, payoutWallet),
          makeBuyLegs(buyRule, payoutWallet, deployment.indexVault),
        ],
      },
    ]);
    const receipt = receipts?.[0];
    if (!receipt) return;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== deployment.covenantFactory.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: covenantFactoryAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "RouterDeployed") {
          setLaunched({
            symbol,
            token: ev.args.token,
            router: ev.args.router,
            tx: receipt.transactionHash,
          });
        }
      } catch {
        // Ignore other events
      }
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Launch with Fee Lock"
      subtitle="Deploy a coin on Ascend whose creator fees follow permanent contract rules with no admin key."
      maxWidthClass="lg:max-w-xl"
    >
      <div className="space-y-5">
        {launched && (
          <div className="rounded-[20px] bg-forest/12 p-4 text-forest">
            <p className="heading-card text-[17px]">{launched.symbol} is live with permanent fee rules</p>
            <div className="mt-2 flex flex-wrap gap-4 text-[13.5px] font-bold underline underline-offset-2">
              <a href={explorer("token", launched.token)} target="_blank" rel="noreferrer">
                Coin Contract ↗
              </a>
              <a href={explorer("address", launched.router)} target="_blank" rel="noreferrer">
                Fee Router ↗
              </a>
              <a href={explorer("tx", launched.tx)} target="_blank" rel="noreferrer">
                Launch Receipt ↗
              </a>
            </div>
          </div>
        )}

        {/* Name & Ticker */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="fl-name" className="ui-label">
              Coin Name
            </label>
            <input
              id="fl-name"
              value={name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
              placeholder="Solaris"
              className="canon-input mt-1.5 min-h-[48px] w-full px-3.5 text-[15px] font-semibold"
            />
          </div>
          <div>
            <label htmlFor="fl-sym" className="ui-label">
              Ticker
            </label>
            <input
              id="fl-sym"
              value={symbol}
              maxLength={10}
              onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="SLR"
              className="canon-input num mt-1.5 min-h-[48px] w-full px-3.5 text-[15px] font-bold"
            />
          </div>
        </div>

        {/* Sell Fee Rule */}
        <div>
          <p className="ui-label mb-2">Sell Fee (Paid in Your Coin)</p>
          <SegmentedControl<SellRule>
            ariaLabel="Sell fee rule"
            value={sellRule}
            onChange={setSellRule}
            options={[
              { id: "burn", label: "100% Burn" },
              { id: "half", label: "50/50 Split" },
              { id: "pay", label: "100% Wallet" },
            ]}
          />
          <p className="mt-1.5 text-[12.5px] text-stone">
            {sellRule === "burn"
              ? "Every sell burns your coin permanently so supply only shrinks."
              : sellRule === "half"
                ? "Half burns supply forever; half pays your chosen wallet."
                : "100% of the creator sell fee goes straight to your chosen wallet."}
          </p>
        </div>

        {/* Buy Fee Rule */}
        <div>
          <p className="ui-label mb-2">Buy Fee (Paid in USDC)</p>
          <SegmentedControl<BuyRule>
            ariaLabel="Buy fee rule"
            value={buyRule}
            onChange={setBuyRule}
            options={[
              { id: "split", label: "50% Vault" },
              { id: "basket", label: "100% Vault" },
              { id: "pay", label: "100% Wallet" },
            ]}
          />
          <p className="mt-1.5 text-[12.5px] text-stone">
            {buyRule === "split"
              ? "Half pays your wallet in USDC; half feeds CANON's Vault."
              : buyRule === "basket"
                ? "Every buy fee feeds CANON's top-coin Vault."
                : "100% of the creator buy fee pays your wallet in USDC."}
          </p>
        </div>

        {needsWallet && (
          <div>
            <label htmlFor="fl-wallet" className="ui-label">
              Payout Wallet (Locked at Launch)
            </label>
            <input
              id="fl-wallet"
              value={payTo}
              onChange={(e) => setPayTo(e.target.value.trim())}
              placeholder={address ?? "0x…"}
              spellCheck={false}
              className="canon-input num mt-1.5 min-h-[48px] w-full px-3.5 text-[14px] font-semibold"
            />
          </div>
        )}

        {!onChain ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenWallet();
            }}
            className="btn-primary w-full"
          >
            Connect Wallet to Launch
          </button>
        ) : (
          <button
            type="button"
            disabled={ascendPaused || !!validationIssue || !!tx.busy}
            onClick={handleLaunch}
            className="btn-signal w-full"
          >
            {tx.busy ??
              (ascendPaused
                ? "Ascend Testnet Launches Paused Ahead of Mainnet"
                : validationIssue ?? "Launch Coin with Locked Rules")}
          </button>
        )}

        {ascendPaused && (
          <p className="text-[12.5px] leading-relaxed text-stone">
            Ascend has temporarily paused new launches on testnet while preparing mainnet. Existing Fee Lock routers below continue to run normally.
          </p>
        )}

        <TxFeedback error={tx.error} lastTx={tx.lastTx} />

        {/* Live Fee Lock routers read from Elysium events */}
        <div className="rounded-[20px] bg-surface p-4">
          <div className="flex items-center justify-between">
            <p className="ui-label">Live Fee Lock Routers on Elysium</p>
            <span className="num text-[12px] font-bold text-stone">{deployedList.length}</span>
          </div>
          {deployedQuery.isLoading ? (
            <p className="mt-3 text-[13.5px] text-stone">Reading chain events…</p>
          ) : deployedList.length === 0 ? (
            <p className="mt-3 text-[13.5px] text-stone">No Fee Lock routers found yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {deployedList.slice(0, 6).map((item, idx) => {
                const sym = (deployedSyms.data?.[idx]?.result as string | undefined) ?? short(item.token);
                return (
                  <li key={item.router} className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]">
                    <div className="min-w-0">
                      <a
                        href={explorer("address", item.router)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold text-ink hover:underline"
                      >
                        {sym} ↗
                      </a>
                      <span className="ml-2 text-[12px] text-stone">
                        · {item.launched ? "Launched" : "Moved in"}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={!onChain || !!tx.busy}
                      onClick={() =>
                        tx.run("Running fee router", [
                          { address: item.router, abi: covenantRouterAbi, functionName: "run" },
                        ])
                      }
                      className="btn-secondary min-h-[36px] px-3 text-[12.5px]"
                    >
                      Run Fees
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

/* ============================================================================
 * 6. PLAIN-ENGLISH TERMS SHEET
 * ========================================================================== */

export function TermsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Terms of Use"
      subtitle="Plain English · Elysium Testnet"
    >
      <div className="space-y-4 text-[14.5px] leading-relaxed text-ink-soft">
        <div className="space-y-3 rounded-[20px] bg-surface p-5">
          <p className="font-bold text-ink">1. Testnet Coins Have Zero Monetary Value</p>
          <p className="text-stone">
            CANON is currently live on the Elysium Testnet. Test HYPE, test USDC, $CANON, and all Vault coins are free test tokens created solely to try the system before mainnet.
          </p>

          <p className="pt-2 font-bold text-ink">2. Non-Custodial Smart Contracts</p>
          <p className="text-stone">
            Every swap, stake, reward claim, and Fee Lock launch runs directly between your own wallet and public smart contracts on Elysium. Nobody behind this interface holds your keys or can reverse on-chain transactions.
          </p>

          <p className="pt-2 font-bold text-ink">3. Not Financial Advice</p>
          <p className="text-stone">
            Lens coin checks report observable on-chain transaction patterns (launch bundles, rapid back-and-forth loops, and holder share) with public explorer links. A Clean check is not an endorsement or a promise of price performance.
          </p>
        </div>

        <button type="button" onClick={onClose} className="btn-primary w-full">
          Got It
        </button>
      </div>
    </BottomSheet>
  );
}
