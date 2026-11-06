# CANON Go-Live Readiness Plan

Upgrade CANON from a single-RPC testnet build into a resilient, production-ready mobile-first index application with multi-RPC failover, real-time market telemetry, cloud-synced user portfolios, and native-feeling PWA installability.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirm the default launch posture below before implementation begins. All choices can be adjusted later without data loss.

- **Default Network Posture (Recommended: Elysium Testnet with 1-Tap Mainnet Switch)**: Launch with Elysium Testnet (`99801`) active by default so new users can test 1-tap minting, staking, and voting immediately, while offering a 1-tap switcher to Elysium Mainnet once mainnet contract addresses are configured.
- **Cloud Persistence (Recommended: Firebase Auth + Firestore)**: Persist user watchlists, transaction receipts, and price alerts in Firestore keyed by authenticated user ID, with automatic fallback to local browser storage when signed out.
- **Mobile Installability (Recommended: Full PWA Support)**: Bundle a Web App Manifest, home-screen icons, and offline shell caching so iOS and Android users can install CANON directly to their home screen.

---

## 1. Overview & Core Concept

- **What It Does**: Transforms the CANON index app into a live-ready financial product with resilient blockchain connectivity, live NAV and constituent price feeds, persistent user activity history, and installable mobile app behavior.
- **Target Audience / Persona**: Mobile-first crypto users on iOS and Android managing index exposure, staking `$CANON`, and voting on constituent rounds with one-handed thumb ergonomics.
- **Key Value**: Eliminates single-point-of-failure RPC timeouts, keeps portfolio history and alerts synced across devices, and delivers instant app-like startup on mobile.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  - **1-Tap Network & Wallet Flow**: User taps `Connect` in the top bar, signs in or links their `0x` wallet, and sees the YOYO Liquid Glass capsule verify network state and live balances.
  - **Live Trade & Slippage Guard**: User enters a swap amount on the Trade tab, views real-time NAV quote, price impact, and gas estimate, and tracks transaction confirmation in-app.
  - **Persistent Portfolio & Alerts**: User bookmarks constituent coins, sets target price alerts, and reviews past mints, stakes, and ballots across sessions.
  - **Installable Mobile App**: Mobile visitors see a clean, non-intrusive install prompt to add CANON to their home screen.
- **Visual Identity & Theme**:
  - **Aesthetic Direction**: Minimalist **Elysium UI** with **OxygenOS Liquid Glass** surfaces and **Apple Siri Liquid Glass** active rims, keeping copy plain, direct, and free of technical jargon.
  - **Color Palette & Mood**: High-contrast dark-first Elysium canvas (`--bg-canvas`, `--bg-surface`, `--bg-well`) paired with crisp white typography (`--fg-ink`), muted secondary metadata (`--fg-stone`), and electric signal accents (`--accent-signal`).
  - **Typography & Hierarchy**: Thick, iPhone-inspired display headings paired with clean geometric body text and `tabular-nums` monospace numerals for all balances, prices, and percentages.
  - **Component Styling & Layout**: Mobile-first thumb-zone layout (`44x44px` minimum touch targets, bottom navigation dock within the 15% sticky viewport budget, slide-up action sheets) that expands cleanly into a multi-column grid on desktop.
- **Interactive Feedback & Motion**:
  - **YOYO Optical Capsule**: Live gaze tracking, liquid tap ripple, and 10-second idle mode with centered glowing eyes and glitching code stream.
  - **Resilient Feedback States**: Inline retry banners for transient network drops, skeleton shimmer during initial quote fetch, and crisp confirmation toasts on transaction finality.

---

## 3. Key Product Decisions & Trade-Offs

- **Multi-RPC Failover Pool**:
  - *Chosen Approach*: Configure an ordered list of primary and fallback RPC endpoints on the server and client with automatic health checks and sub-3.5s timeouts.
  - *Why*: Public testnet and mainnet RPC nodes occasionally rate-limit or stall; automatic failover keeps balances and quotes responsive.
  - *Alternatives Considered*: Relying on a single hardcoded RPC URL, which causes blank balances during node maintenance.
- **Hybrid Cloud + Local Persistence**:
  - *Chosen Approach*: Store user watchlists, alert rules, and transaction receipts in Firestore when signed in, while mirroring state locally for instant zero-latency rendering.
  - *Why*: Users keep their history when switching devices or clearing browser cache, without blocking guest exploration.
  - *Alternatives Considered*: Local-only browser storage, which loses all user history on device change.
- **Server-Side Quote & Telemetry Caching**:
  - *Chosen Approach*: Cache on-chain index NAV, constituent weights, and gas prices on the Express backend for 5–10 seconds per request window.
  - *Why*: Prevents redundant RPC calls during traffic spikes and protects rate-limited free-tier endpoints.
  - *Alternatives Considered*: Direct per-client polling on every render, which exhausts RPC quotas quickly.

---

## 4. Technical Architecture & Data Strategy

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Mobile / Desktop Client                       │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │  Elysium Shell │  │ YOYO Liquid Eye  │  │  PWA Service Worker  │  │
│  │  & Bottom Dock │  │ & Idle Code Mode │  │  & Offline Manifest  │  │
│  └───────┬────────┘  └────────┬─────────┘  └──────────┬───────────┘  │
│          │                    │                       │              │
│  ┌───────▼────────────────────▼───────────────────────▼───────────┐  │
│  │           State & Query Layer (Wagmi + React Query)            │  │
│  └───────┬────────────────────────────────────────────┬───────────┘  │
└──────────┼────────────────────────────────────────────┼──────────────┘
           │ REST / JSON                                │ SDK
┌──────────▼──────────────────────┐          ┌──────────▼──────────────┐
│     Express Backend Server      │          │   Firebase Cloud Layer  │
│  ┌───────────────────────────┐  │          │  ┌───────────────────┐  │
│  │  Multi-RPC Failover Pool  │  │          │  │  User Auth        │  │
│  └─────────────┬─────────────┘  │          │  └─────────┬─────────┘  │
│  ┌─────────────▼─────────────┐  │          │  ┌─────────▼─────────┐  │
│  │  NAV & Price Cache (TTL)  │  │          │  │  Firestore Rules  │  │
│  └─────────────┬─────────────┘  │          │  │  & User Records   │  │
│  ┌─────────────▼─────────────┐  │          │  └───────────────────┘  │
│  │  Ballot & Deploy Verifier │  │          └─────────────────────────┘
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

- **Data Model & State**:
  - **Network Config**: Active chain ID (`99801` Testnet or Mainnet), ordered RPC URLs, block explorer base URL, and deployed contract addresses.
  - **Index & Constituent Snapshot**: `$CANON` NAV, 24h change, total supply, constituent token weights, liquidity depth, and last-updated timestamp.
  - **User Profile & Activity**: Authenticated user ID, linked `0x` wallet address, saved watchlist tokens, target price alerts, and signed transaction/ballot receipts.
- **Interactive Component & State Mapping**:
  - **Network Switcher**: Validates target chain, updates active contract addresses, invalidates cached queries, and prompts wallet chain switch if connected.
  - **Trade & Stake Sheets**: Validates numeric input against live wallet balance, computes minimum received with configurable slippage, submits transaction, and records receipt on confirmation.
  - **Error Boundary & Offline Banner**: Catches unexpected UI or RPC failures and provides a 1-tap reset or cached-data fallback without crashing the viewport.
