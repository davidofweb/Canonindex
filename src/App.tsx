/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { useConnection } from "wagmi";
import { Providers } from "@/components/app/providers";
import { EarnView } from "@/components/canon/earn-view";
import { HomeView } from "@/components/canon/home-view";
import { LensView } from "@/components/canon/lens-view";
import type { TabKey } from "@/components/canon/shared";
import {
  CoinReportSheet,
  DisputeSheet,
  FeeLockSheet,
  HypePassSheet,
  TermsSheet,
  WalletSheet,
} from "@/components/canon/sheets";
import { CanonShell } from "@/components/canon/shell";
import { TestnetStudioSheet } from "@/components/canon/testnet-studio";
import { TradeView } from "@/components/canon/trade-view";
import { VoteView } from "@/components/canon/vote-view";
import { YoyoBootScreen, YoyoIdleEyesOverlay, YoyoVerifyOverlay } from "@/components/canon/yoyo-eye";
import { elysium, syncDeploymentFromServer, useDeploymentVersion } from "@/lib/chain/config";
import { INITIAL_DELPHI, liveRound, readDelphi, type Delphi } from "@/lib/delphi";
import { INITIAL_LIVE, readLive, type Live } from "@/lib/live";
import {
  completeBootSequence,
  dismissAddressVerify,
  finishAddressVerify,
  startAddressVerify,
  updateBootProgress,
  useYoyoLoader,
} from "@/lib/yoyo-loader";
import { navigate, useLocationState } from "@/shims/router";

const TAB_PATHS: Record<TabKey, string> = {
  home: "/",
  trade: "/trade",
  earn: "/earn",
  vote: "/vote",
  lens: "/lens",
};

const TAB_TITLES: Record<TabKey, string> = {
  home: "CANON · Ten clean coins. One liquid index.",
  trade: "Trade $CANON · CANON",
  earn: "Stake & Earn · CANON",
  vote: "The Ballot · CANON",
  lens: "The Lens & Fee Lock · CANON",
};

function parseRoute(pathname: string): {
  tab: TabKey;
  coinToken: string | null;
  autoSheet: "pass" | "feelock" | "terms" | "dispute" | "studio" | null;
} {
  const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

  if (clean === "/testnet" || clean === "/studio" || clean === "/launch") {
    return { tab: "home", coinToken: null, autoSheet: "studio" };
  }
  if (clean === "/trade" || clean === "/get") {
    return { tab: "trade", coinToken: null, autoSheet: null };
  }
  if (clean === "/earn" || clean === "/stake") {
    return { tab: "earn", coinToken: null, autoSheet: null };
  }
  if (clean === "/vote" || clean === "/trials" || clean === "/trials/vote") {
    return { tab: "vote", coinToken: null, autoSheet: null };
  }
  if (clean === "/passport" || clean === "/passport/get") {
    return { tab: "earn", coinToken: null, autoSheet: "pass" };
  }
  if (clean === "/covenant" || clean === "/covenant/launch" || clean === "/feelock") {
    return { tab: "lens", coinToken: null, autoSheet: "feelock" };
  }
  if (clean === "/terms") {
    return { tab: "home", coinToken: null, autoSheet: "terms" };
  }
  if (clean === "/lens/dispute" || clean === "/delphi/dispute") {
    return { tab: "lens", coinToken: null, autoSheet: "dispute" };
  }
  if (clean.startsWith("/lens/")) {
    const token = decodeURIComponent(clean.slice("/lens/".length));
    return { tab: "lens", coinToken: token || null, autoSheet: null };
  }
  if (clean.startsWith("/delphi/") && clean !== "/delphi/kalos") {
    const token = decodeURIComponent(clean.slice("/delphi/".length));
    return { tab: "lens", coinToken: token || null, autoSheet: null };
  }
  if (clean === "/lens" || clean === "/delphi" || clean === "/delphi/kalos") {
    return { tab: "lens", coinToken: null, autoSheet: null };
  }
  return { tab: "home", coinToken: null, autoSheet: null };
}

/**
 * Watches wallet connection & account switches to trigger the YOYO Liquid Glass
 * 0x address verification scan whenever a wallet connects or changes address.
 */
function WalletAddressVerifyWatcher() {
  const { address, isConnected, chainId } = useConnection();
  const prevAddrRef = useRef<string | undefined>(undefined);
  const mountedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    // Clear any stale verification toasts on mount
    dismissAddressVerify();
  }, []);

  useEffect(() => {
    if (!isConnected || !address) {
      prevAddrRef.current = undefined;
      dismissAddressVerify();
      return;
    }

    if (prevAddrRef.current?.toLowerCase() === address.toLowerCase()) {
      return;
    }
    const isInitialMount = Date.now() - mountedAtRef.current < 1500;
    prevAddrRef.current = address;

    // Skip toast during initial mount; trigger only for live connects or account switches
    if (isInitialMount) return;

    startAddressVerify({
      posture: "scan",
      address,
      label: "Verifying wallet address",
      sublabel: "Reading Elysium state",
    });

    const timer = window.setTimeout(() => {
      const onElysium = chainId === elysium.id;
      finishAddressVerify({
        ok: onElysium,
        address,
        label: onElysium ? "Address verified" : "Switch to Elysium 99801",
        sublabel: onElysium ? "Elysium 99801 ready" : "Wrong network",
        holdMs: 1150,
      });
    }, 760);

    return () => window.clearTimeout(timer);
  }, [address, isConnected, chainId]);

  return null;
}

function CanonWorkspace() {
  const { idle } = useYoyoLoader();
  const { pathname } = useLocationState();
  const route = parseRoute(pathname);
  const deployVersion = useDeploymentVersion();

  const [live, setLive] = useState<Live>(INITIAL_LIVE);
  const [delphi, setDelphi] = useState<Delphi>(INITIAL_DELPHI);

  const [walletOpen, setWalletOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(route.autoSheet === "pass");
  const [feeLockOpen, setFeeLockOpen] = useState(route.autoSheet === "feelock");
  const [termsOpen, setTermsOpen] = useState(route.autoSheet === "terms");
  const [studioOpen, setStudioOpen] = useState(route.autoSheet === "studio");
  const [reportToken, setReportToken] = useState<string | null>(route.coinToken);
  const [disputeTarget, setDisputeTarget] = useState<{ open: boolean; token: string; symbol?: string }>({
    open: route.autoSheet === "dispute",
    token: "",
  });

  // Coordinate initial app open YOYO Liquid Glass boot sequence with real Elysium sync
  useEffect(() => {
    let cancelled = false;
    const startedAt = performance.now();
    const MIN_WAKE_MS = 1280;
    const MAX_WAIT_MS = 2950;

    const safetyCeiling = window.setTimeout(() => {
      if (!cancelled) completeBootSequence();
    }, MAX_WAIT_MS);

    (async () => {
      updateBootProgress({
        progress: 0.34,
        label: "Syncing Elysium Vault",
        detail: "Chain 99801 · Checking active contracts",
      });

      await syncDeploymentFromServer().catch(() => null);
      if (cancelled) return;

      updateBootProgress({
        progress: 0.68,
        label: "Reading 10-Coin Index",
        detail: "Vault balances · Lens coin checks",
      });

      const [liveRes, delphiRes] = await Promise.allSettled([readLive(), readDelphi()]);
      if (cancelled) return;

      if (liveRes.status === "fulfilled") {
        setLive(liveRes.value);
      }
      if (delphiRes.status === "fulfilled" && delphiRes.value) {
        setDelphi(delphiRes.value);
      }

      const coinCount =
        delphiRes.status === "fulfilled" && delphiRes.value
          ? delphiRes.value.counts.coins
          : INITIAL_DELPHI.counts.coins;

      updateBootProgress({
        progress: 0.96,
        ready: true,
        label: "Vault Ready",
        detail: `${coinCount} coins scanned · Elysium 99801`,
      });

      const elapsed = performance.now() - startedAt;
      const waitRemaining = Math.max(220, MIN_WAKE_MS - elapsed);
      window.setTimeout(() => {
        if (!cancelled) completeBootSequence();
      }, waitRemaining);
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(safetyCeiling);
    };
  }, []);

  // Sync URL-driven sheet states when browser back/forward runs
  useEffect(() => {
    if (route.coinToken) setReportToken(route.coinToken);
    if (route.autoSheet === "pass") setPassOpen(true);
    if (route.autoSheet === "feelock") setFeeLockOpen(true);
    if (route.autoSheet === "terms") setTermsOpen(true);
    if (route.autoSheet === "studio") setStudioOpen(true);
    if (route.autoSheet === "dispute") setDisputeTarget({ open: true, token: "" });
  }, [route.coinToken, route.autoSheet]);

  // Poll live chain + Lens data cleanly and re-read whenever active deployment switches
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      readLive().then((next) => {
        if (!cancelled) setLive(next);
      });
      readDelphi().then((next) => {
        if (!cancelled && next) setDelphi(next);
      });
    };
    if (deployVersion > 0) {
      refresh();
    }
    const id = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [deployVersion]);

  useEffect(() => {
    document.title = TAB_TITLES[route.tab];
  }, [route.tab]);

  const handleSelectTab = (tab: TabKey) => {
    const dest = TAB_PATHS[tab];
    if (pathname !== dest) {
      navigate(dest);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleInspectCoin = (token: string) => {
    setReportToken(token);
  };

  const currentRound = liveRound(live.basket?.coins.map((c) => c.token) ?? null);

  return (
    <>
      <YoyoBootScreen />
      <YoyoVerifyOverlay />
      <YoyoIdleEyesOverlay />
      <WalletAddressVerifyWatcher />

      <div
        key={deployVersion}
        className={`transition-opacity duration-300 ${idle ? "pointer-events-none opacity-0 select-none" : "opacity-100"}`}
      >
        <CanonShell
          activeTab={route.tab}
          onSelectTab={handleSelectTab}
          onOpenWallet={() => setWalletOpen(true)}
          onOpenTerms={() => setTermsOpen(true)}
          onOpenStudio={() => setStudioOpen(true)}
        >
          {route.tab === "home" && (
            <HomeView
              live={live}
              onNavigate={handleSelectTab}
              onInspectCoin={handleInspectCoin}
              onOpenPass={() => setPassOpen(true)}
              onOpenFeeLock={() => setFeeLockOpen(true)}
            />
          )}

          {route.tab === "trade" && (
            <TradeView
              onOpenWallet={() => setWalletOpen(true)}
              onNavigate={handleSelectTab}
            />
          )}

          {route.tab === "earn" && (
            <EarnView
              onOpenWallet={() => setWalletOpen(true)}
              onOpenPass={() => setPassOpen(true)}
              onNavigate={handleSelectTab}
            />
          )}

          {route.tab === "vote" && (
            <VoteView
              onOpenWallet={() => setWalletOpen(true)}
              onOpenPass={() => setPassOpen(true)}
              onInspectCoin={handleInspectCoin}
              onNavigate={handleSelectTab}
            />
          )}

          {route.tab === "lens" && (
            <LensView
              delphi={delphi}
              currentRound={currentRound}
              onInspectCoin={handleInspectCoin}
              onOpenFeeLock={() => setFeeLockOpen(true)}
              onOpenDispute={() => setDisputeTarget({ open: true, token: "" })}
            />
          )}
        </CanonShell>

        {/* Slide-Up iPhone Action Sheets */}
        <WalletSheet
          open={walletOpen}
          onClose={() => setWalletOpen(false)}
          onOpenPass={() => setPassOpen(true)}
          onOpenStudio={() => setStudioOpen(true)}
        />

        <HypePassSheet
          open={passOpen}
          onClose={() => setPassOpen(false)}
          onOpenWallet={() => setWalletOpen(true)}
        />

        <CoinReportSheet
          open={!!reportToken}
          token={reportToken}
          delphi={delphi}
          currentRound={currentRound}
          onClose={() => {
            setReportToken(null);
            if (pathname.startsWith("/lens/") || pathname.startsWith("/delphi/")) {
              navigate("/lens");
            }
          }}
          onChallenge={(token, symbol) => {
            setReportToken(null);
            setDisputeTarget({ open: true, token, symbol });
          }}
        />

        <DisputeSheet
          open={disputeTarget.open}
          token={disputeTarget.token}
          symbol={disputeTarget.symbol}
          onClose={() => setDisputeTarget({ open: false, token: "" })}
        />

        <FeeLockSheet
          open={feeLockOpen}
          onClose={() => setFeeLockOpen(false)}
          onOpenWallet={() => setWalletOpen(true)}
        />

        <TermsSheet open={termsOpen} onClose={() => setTermsOpen(false)} />
      </div>

      <TestnetStudioSheet
        open={studioOpen}
        onClose={() => {
          setStudioOpen(false);
          if (pathname === "/testnet" || pathname === "/studio" || pathname === "/launch") {
            navigate("/");
          }
        }}
        onOpenWallet={() => setWalletOpen(true)}
        onOpenTrade={() => {
          setStudioOpen(false);
          navigate("/trade");
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <Providers>
      <CanonWorkspace />
    </Providers>
  );
}
