# Guided Mobile Wallet Launch for $CANON Testnet

A streamlined, mobile-first launch flow that lets you deploy, seed, and share a live **$CANON** token suite on **Elysium Testnet (Chain 99801)** straight from your phone wallet—giving crowdfunders and Elysium/Hyperliquid grant reviewers a live, one-tap testable link and verified contract proof without adding extra pitch pages to the app.

## User Review & Critical Decisions

> [!IMPORTANT]
> Please review the confirmed scope below before we build. Tap **Proceed** to implement, or share any adjustments in chat.

- **Confirmed — Focus Strictly on Token Launch (No Extra Pitch View)**: We will keep CANON's core five-tab navigation (`Home`, `Trade`, `Earn`, `Vote`, `Lens`) clean and untouched—no separate investor deck view.
- **Confirmed — Simpler Guided Phone-Wallet Launch**: Replace the multi-tab wall of manual `0x` inputs as the default experience with a single-screen **3-Step Guided Launch** (`1. Wallet & Gas` → `2. Deploy $CANON` → `3. Seed & Share`), while keeping a `Full Controls` toggle for custom worker keys and Cloudflare snippets.
- **Confirmed — Built for Crowdfunders & Grant Reviewers**: After launch, CANON generates a **portable live share link** (encoding your deployed Elysium contract addresses in the URL so any reviewer opening the link on any phone immediately connects to *your* live `$CANON` token) plus a one-tap **Copy Grant Proof** block with live Elysium Explorer links.

---

## 1. Overview & Core Concept

- **What It Does**: Turns deploying the 8-contract `$CANON` protocol suite on Elysium Testnet into a guided three-step mobile checklist. Role addresses (`Team`, `Pass Signer`, `Curator`, `Guardian`) and local worker keys are prepared automatically from your connected wallet so you never have to copy-paste four hex addresses on a phone screen.
- **Target Audience / Persona**:
  1. **Founder / Creator (You)**: Deploying `$CANON` from a mobile or browser wallet with free test `HYPE`, locking the creator fee split (`85%` Vault & Burn / `15%` Team default), and seeding initial liquidity + free test token drip.
  2. **Crowdfunders & Elysium / Hyperliquid Grant Committees**: Opening your shared link on mobile or desktop, claiming `250 $CANON` from the live drip faucet in one tap, testing live buys/burns/staking, and verifying every immutable contract on the Elysium Explorer.
- **Key Value**: Removes deployment friction on mobile wallets and eliminates the "works only in my browser" problem by making your custom testnet deployment portable via URL and synced with the app backend.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Open Guided Launch**: Tap **Launch $CANON** inside the Wallet sheet, footer, or via `/launch` (`/testnet`).
  2. **Step 01 · Wallet & Free Gas**: Connects your phone wallet, switches to **Elysium Testnet (99801)** in one tap if needed, displays live `HYPE` balance in tabular numerals, and offers a direct `Claim Free HYPE` faucet action when gas is zero.
  3. **Step 02 · Deploy $CANON Suite**: Choose ticker (`$CANON`) and permanent creator fee split (`0%`, `10%`, `15%`, or `20%` Team; remainder locked to Vault & Burn). A single primary button runs the resumable on-chain deployment sequence while the **Liquid Glass YOYO** stage tracks wallet signing (`sign` → `confirm`) and saves progress after every confirmed block so mobile wallet app-switching never loses your place.
  4. **Step 03 · Seed Backer Faucet & Share**: One tap mints free test `USDC`, seeds the `$CANON` pool, funds the `250 $CANON` tester drip, and queues the 10-coin clean basket (`PACT`, `DAWN`, `AK`, `REE`, `TROLOLO`, `QNCE`, `HAZL`, `ANGL`, `PRMR`, `SRRL`). Immediately reveals two one-tap sharing actions:
     - **Copy Live Backer Link**: Shares a URL that automatically switches any crowdfunder or grant reviewer's app straight to your deployed `$CANON` contracts.
     - **Copy Grant Contract Proof**: Copies a clean, plain-language summary of your live Elysium contract addresses, fee-lock split, and explorer URLs ready to paste into an Elysium or Hyperliquid grant form or crowdfunding page.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Minimalist, tactile iPhone-grade hardware precision matching CANON's existing four themes (`Obsidian`, `Cobalt`, `Alabaster`, `Titanium`).
  - *Color Palette & Mood*: 60% neutral canvas (`--bg-canvas`), 30% recessed wells and hairline surfaces (`--bg-surface`, `--bg-well`, `--border-subtle`), and 10% high-contrast signal accents (`--accent-signal`, `--accent-forest` for confirmed on-chain steps).
  - *Typography & Hierarchy*: Thick `Plus Jakarta Sans` (`700`/`800`, tight `-0.03em` tracking) for step titles and action buttons paired with `JetBrains Mono` (`tabular-nums`) for gas balances, fee splits, nonces, and `0x` addresses.
  - *Component Styling & Layout*: Mobile-first bottom sheet (`rounded-t-[28px]`, `min-h-[48px]` thumb targets, zero pill-badge clutter, clean editorial numbering `01` / `02` / `03`, and whitespace + hairline dividers instead of nested cards).
- **Interactive Feedback & Motion**:
  - Live **YOYO Liquid Glass** verification stage inside the launch sheet reacts to wallet signature prompts (`sign` upward focus) and block confirmations (`confirm` happy crescent hop).
  - Instant `Copied ✓` tactile confirmation (<150ms) when copying backer links or grant contract proofs.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Guided 3-Step Flow by Default + Full Controls Toggle**
  - *Chosen Approach*: Default the launch sheet to a clean `Guided` mode that auto-populates role wallets from your connected address and generates local worker keys automatically, with a segmented switch (`Guided` | `Full Controls`) preserving custom role inputs and Cloudflare Worker commands.
  - *Why*: Typing four separate `0x` addresses across four tabs on a phone causes errors and drop-offs, while power operators still retain full control one tap away.
  - *Alternatives Considered*: Keeping four separate tabs (`Setup`, `Launch`, `Seed`, `Workers`) as the only flow—passed over because it obscures the straight path to a live token.
- **Decision 2: URL-Portable Deployment Link for Backers & Grant Reviewers**
  - *Chosen Approach*: Encode the essential deployed `$CANON` contract addresses in a compact `?canon=...` URL parameter alongside server-side persistence.
  - *Why*: Cloud preview instances can sleep or restart between days when grant committees review applications. Including verified `99801` contract addresses in the share link guarantees crowdfunders and grant reviewers always load your exact live `$CANON` token, Vault, and `250 $CANON` faucet drip on the first open.
  - *Alternatives Considered*: Relying only on browser `localStorage` or ephemeral server memory—passed over because external backers on their own phones wouldn't reliably see your custom deployment if the container restarted.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                     URL & Active Deployment Resolver                     │
│  Reads ?canon=... share param ──▶ Validates Chain 99801 0x addresses     │
│  Syncs with /api/deployment  ──▶ Switches Trade / Earn / Vote / Lens     │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                Testnet Launch Sheet (Guided  |  Full Controls)           │
├──────────────────────┬───────────────────────────┬───────────────────────┤
│  01. Wallet & Gas    │  02. Deploy $CANON Suite  │  03. Seed & Share     │
│  • Connect wallet    │  • Auto-fill role wallets │  • Deploy Swapper     │
│  • Switch to 99801   │  • Auto-create local keys │  • Mint 500 Test USDC │
│  • Live HYPE check   │  • Lock 85/15 fee split   │  • Buy initial $CANON │
│  • Free HYPE faucet  │  • Resumable 6-step txns  │  • Fund 250 Drip      │
│                      │  • YOYO Liquid Glass sync │  • Queue 10-coin set  │
└──────────────────────┴─────────────┬─────────────┴───────────┬───────────┘
                                     │                         │
                                     ▼                         ▼
                       ┌──────────────────────────┐ ┌──────────────────────┐
                       │ Elysium Testnet (99801)  │ │ Backer Share Output  │
                       │ • HYPE Pass Registry     │ │ • Portable Live URL  │
                       │ • Fee Lock Factory/Router│ │ • Grant Proof Copy   │
                       │ • $CANON Token & Pool    │ │ • Direct Explorer ↗  │
                       │ • Registry, Staking,Vault│ └──────────────────────┘
                       └──────────────────────────┘
```

- **Data Model & State**:
  - **Resumable Launch Draft (`localStorage` keyed by wallet `0x`)**: Persists every deployed contract address and deployment nonce after each confirmed transaction so if a mobile wallet reloads or pauses mid-launch, tapping **Resume $CANON Launch** continues cleanly from the exact next step.
  - **Compact Share Payload (`?canon=...`)**: Base64url-encoded JSON tuple of the validated Elysium `99801` contract addresses (`launchpad`, `passportRegistry`, `covenantFactory`, `pnth`, `pnthPool`, `pnthRouter`, `constituentRegistry`, `staking`, `indexVault`, `swapper`, `drip`, `team`, `teamBps`, `tokenSymbol`, `deployedBlock`), strictly checked with `isAddress` and `bytes32` validation before activation.
- **Interactive Component & State Mapping**:
  - **Wallet & Network Gate**: Disconnected state triggers `WalletSheet`; wrong-network state calls `switchChain({ chainId: 99801 })` with automatic chain addition fallback for mobile wallets adding Elysium Testnet for the first time.
  - **One-Tap Guided Suite Deploy**: Automatically initializes local worker keys if absent, sets `Team` / `Curator` / `Guardian` to the connected wallet (`Pass Signer` to the generated attestor), drives YOYO's `sign` and `confirm` postures during each wallet signature, and activates the live deployment upon Step 6 completion.
  - **Combined Backer Seed Action**: Chains Pool Swapper deploy, Test USDC mint + approval, initial `$CANON` pool buy, `250 $CANON` drip faucet funding, and 10-coin clean basket proposal (skipping any sub-step already completed in the saved draft), then surfaces the live share URL and grant-ready proof block.
