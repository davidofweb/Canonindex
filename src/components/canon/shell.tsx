import type { ReactNode } from "react";
import { useConnection } from "wagmi";
import {
  ArrowLeftRight,
  CheckSquare,
  Compass,
  Layers,
  Moon,
  ScanSearch,
  Sun,
} from "lucide-react";
import {
  deployment,
  elysium,
  explorer,
  isCustomCanonActive,
  useDeploymentVersion,
} from "@/lib/chain/config";
import { getThemePalette, toggleColorMode, useTheme } from "@/lib/theme";
import { CanonWordmark } from "./code-art";
import { short, ThemeSwitcher, type TabKey } from "./shared";

const NAV_ITEMS: ReadonlyArray<{
  id: TabKey;
  label: string;
  icon: typeof Compass;
}> = [
  { id: "home", label: "Home", icon: Compass },
  { id: "trade", label: "Trade", icon: ArrowLeftRight },
  { id: "earn", label: "Earn", icon: Layers },
  { id: "vote", label: "Vote", icon: CheckSquare },
  { id: "lens", label: "Lens", icon: ScanSearch },
];

export function CanonShell({
  activeTab,
  onSelectTab,
  onOpenWallet,
  onOpenTerms,
  onOpenStudio,
  children,
}: {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
  onOpenWallet: () => void;
  onOpenTerms: () => void;
  onOpenStudio: () => void;
  children: ReactNode;
}) {
  useDeploymentVersion();
  const { address, isConnected, chainId } = useConnection();
  const wrongChain = isConnected && chainId !== elysium.id;
  const customActive = isCustomCanonActive();
  const activeTheme = useTheme();
  const isDark = getThemePalette(activeTheme).isDark;

  const walletButtonLabel = !isConnected
    ? "Connect"
    : wrongChain
      ? "Switch Network"
      : short(address ?? "");

  return (
    <div className="relative flex min-h-dvh flex-col bg-canvas text-ink">
      {/* Elysium UI Zero-Blur Atmospheric Ambient Field */}
      <div
        aria-hidden="true"
        className="elysium-ambient-field pointer-events-none fixed inset-0 -z-10"
      />

      {/* Top Bar:
          - Mobile (<1024px): Scrolls naturally with page (zero sticky top clutter)
          - Desktop (>=1024px): Strict 3-Zone Sticky OxygenOS Glass Top Bar */}
      <header className="bg-canvas/76 backdrop-blur-xl lg:sticky lg:top-0 lg:z-30">
        <div className="mx-auto flex h-15 max-w-6xl items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Geometric Vault Wordmark */}
          <button
            type="button"
            onClick={() => onSelectTab("home")}
            className="code-glitch inline-flex min-h-[44px] shrink-0 cursor-pointer items-center whitespace-nowrap text-ink"
            aria-label="CANON Home"
          >
            <CanonWordmark />
          </button>

          {/* Zone 2: 5 Clean Single-Line Navigation Links */}
          <nav aria-label="Main navigation" className="hidden items-center gap-8 lg:flex">
            {NAV_ITEMS.map((item) => {
              const active = item.id === activeTab;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`relative min-h-[44px] cursor-pointer whitespace-nowrap text-[14.5px] font-bold tracking-[-0.015em] transition-colors ${
                    active ? "text-ink" : "text-stone hover:text-ink"
                  }`}
                >
                  {item.label}
                  {active && (
                    <span className="absolute inset-x-0 bottom-0 h-[2px] bg-signal" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Quick Dark/Light Toggle + Single Minimalist Wallet Action */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleColorMode}
              className="inline-flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-[12px] bg-surface text-ink transition-transform hover:bg-well active:scale-95 shadow-sm"
              aria-label={isDark ? "Switch to Alabaster light theme" : "Switch to Elysium UI dark theme"}
              title={isDark ? "Light (Alabaster)" : "Dark (Elysium UI)"}
            >
              {isDark ? (
                <Sun className="h-[18px] w-[18px] text-amber-tone" />
              ) : (
                <Moon className="h-[18px] w-[18px] text-ink" />
              )}
            </button>

            <button
              type="button"
              onClick={onOpenWallet}
              className={`code-glitch inline-flex min-h-[40px] shrink-0 cursor-pointer items-center whitespace-nowrap rounded-[12px] px-4 text-[13.5px] font-bold tracking-[-0.015em] transition-colors ${
                wrongChain
                  ? "bg-signal text-signal-ink"
                  : isConnected
                    ? "bg-surface text-ink hover:bg-well"
                    : "bg-primary-bg text-primary-fg hover:opacity-90"
              }`}
            >
              <span className={isConnected && !wrongChain ? "num" : ""}>{walletButtonLabel}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-safe-nav sm:px-6 lg:py-10">
        {children}
      </main>

      {/* Minimalist Architectural Footer + 4-Skin Theme Switcher */}
      <footer className="pb-safe-nav lg:pb-0">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-7 text-[12.5px] text-stone sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <CanonWordmark compact />
              <span aria-hidden="true">·</span>
              <span>
                {customActive && deployment
                  ? `Live $${deployment.tokenSymbol ?? "CANON"} (${short(deployment.pnth)})`
                  : "Elysium Testnet"}
              </span>
              <span aria-hidden="true">·</span>
              <span>Test coins carry no monetary value</span>
            </div>

            <ThemeSwitcher />
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-3 font-semibold">
            {deployment && (
              <>
                <a
                  href={explorer("token", deployment.pnth)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-ink"
                >
                  Token ↗
                </a>
                <a
                  href={explorer("address", deployment.indexVault)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-ink"
                >
                  Vault ↗
                </a>
                <a
                  href={explorer("address", deployment.staking)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-ink"
                >
                  Staking ↗
                </a>
              </>
            )}
            <button
              type="button"
              onClick={onOpenTerms}
              className="cursor-pointer font-semibold hover:text-ink"
            >
              Terms
            </button>
          </div>
        </div>
      </footer>

      {/* Mobile OxygenOS Liquid Glass Floating Dock (Pinned <9% viewport height; hidden on lg: desktop) */}
      <nav
        aria-label="Mobile bottom navigation"
        className="bottom-bar-safe pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-2 lg:hidden"
      >
        <div className="oxygen-glass-dock pointer-events-auto mx-auto grid h-[58px] max-w-md grid-cols-5 rounded-[24px] px-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeTab;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative flex min-h-[48px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[18px] transition-all duration-150 active:scale-[0.95] ${
                  active ? "text-signal" : "text-stone hover:text-ink"
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 h-[2.5px] w-5 rounded-full bg-signal"
                  />
                )}
                <Icon className={`h-[19px] w-[19px] ${active ? "stroke-[2.5]" : "stroke-[1.9]"}`} />
                <span className={`text-[10.5px] tracking-[-0.01em] ${active ? "font-extrabold text-ink" : "font-bold"}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
