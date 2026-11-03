# CANON Vault & Boost Keeper Worker (Zero VPS · Free 5-Minute Cron)

Runs every 5 minutes on Cloudflare Workers' free Cron Trigger (zero VPS required). Simulates fee collection (`CovenantRouter.run()`), 10-coin basket purchases (`IndexVault.rebalance(5)`), and staking multiplier refreshes (`PantheonStaking.poke(...)`) first—sending transactions only when real fees or boost updates are ready.

## 3-Minute Deploy Steps

```bash
cd workers/keeper-worker
npm install

# 1. Create a free Cloudflare KV store and paste its ID into wrangler.toml
npx wrangler kv namespace create KEEPER_KV

# 2. Paste your exported CANON_DEPLOYMENT_JSON from Testnet Studio into wrangler.toml
# 3. Upload your keeper wallet private key (funded with ~0.05 Test HYPE):
npx wrangler secret put KEEPER_KEY

# 4. Deploy live (Cloudflare runs the */5 * * * * Cron Trigger automatically)
npx wrangler deploy
```

Prefer GitHub Actions instead of Cloudflare for the 5-minute cron? Enable `.github/workflows/canon-keeper-cron.yml` in your repository and add `KEEPER_KEY` + `CANON_DEPLOYMENT_JSON` under **Settings → Secrets and variables → Actions**.
