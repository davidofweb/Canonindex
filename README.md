# CANON

> Ten clean coins. One liquid index on Elysium.

CANON brings ten high-volume ecosystem coins together into a single balanced index token. Every trade strengthens the system: buy trades automatically deposit rewards into the Staking Vault for holders, and sell trades burn tokens to lower circulating supply.

---

## Highlights

- **Ten Coins in One Token**: Instant access to ten top ecosystem coins in a single balance.
- **Auto Vault Yield**: 5% of buys feed directly into the Vault, giving stakers continuous rewards.
- **Supply Burn**: 5% of sells burn permanently, steadily tightening the supply.
- **Two Pure Color Modes**:
  - **Light (Alabaster)**: Warm stone canvas with emerald signal accents.
  - **Dark (Elysium UI)**: Deep liquid obsidian canvas with bright mint signal accents.
  - Instant one-tap switch in the top header and footer.
- **Clean Borderless Screen**: Zero outline strokes, zero card borders, and pure elevation depth via subtle lighting and liquid glass curves.
- **YOYO Idle State**: When idle for 10 seconds, text gracefully clears away to focus on centered liquid glass YOYO eyes streaming live code with digital glitch flickers.
- **Mobile First**: Built for iPhone and modern touch screens with large touch points and heavyweight display typography.

---

## App Screens

1. **Home**
   - Real-time index price chart, market cap, and total volume.
   - Coin weight distribution table with live price changes.
   - Live YOYO eye interactive liquid glass focal piece.

2. **Trade**
   - Direct swaps between HYPE and $CANON.
   - Quick amount chips ($25, $100, $500, 25%, 50%, 75%, Max).
   - Real-time rate calculation, route summary, and slippage controls.

3. **Earn**
   - Stake $CANON to start earning yield from the Vault.
   - Transparent pool share, pending rewards balance, and claim button.

4. **Vote**
   - Community governance proposals on token weights and index rebalancing.
   - Transparent on-chain ballot casting and live results tally.

5. **Lens**
   - Instant address lookup to view holdings, coin weights, and transaction receipts.
   - Full testnet transparency across all ten basket assets.

---

## Tech Stack

- **Framework**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS with custom borderless liquid glass tokens
- **Web3**: Wagmi + Viem
- **Chain**: Elysium Testnet (Chain ID 99801)
- **Icons**: Lucide Icons
- **Animation**: Motion + Custom CSS optical shaders

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set any optional variables (such as a custom RPC URL or WalletConnect Project ID). Public endpoints work out of the box with zero paid keys required.

### 3. Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

### 4. Build for Production

```bash
npm run build
```

---

## Network Details

- **Network**: Elysium Testnet
- **Chain ID**: `99801`
- **Native Gas Coin**: Test HYPE
- **Explorer**: https://testnet.elysiumscan.org

---

## License

MIT
