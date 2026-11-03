# CANON HYPE Pass Worker (Zero VPS · Free Cloudflare Worker)

Runs the HYPE Pass balance checker, tier signer, and gas-free relayer on Cloudflare's free tier with zero Linux servers to manage.

## What You Need
1. A free [Cloudflare account](https://dash.cloudflare.com/sign-up).
2. Your deployed `HypePassportRegistry` address from **Testnet Studio** inside the CANON app.
3. Three fresh hex values generated in **Testnet Studio → Setup**:
   - `ATTESTOR_KEY` (matches the Pass Signer public address given to `HypePassportRegistry`)
   - `RELAYER_KEY` (funded with ~`0.05 Test HYPE` on Elysium Testnet so users pay zero gas)
   - `PEPPER_SALT` (32-byte random hex value used to hash Hyperliquid addresses privately)

## 3-Minute Deploy Steps

```bash
cd workers/passport-worker
npm install

# 1. Create a free Cloudflare KV store and paste its ID into wrangler.toml
npx wrangler kv namespace create PASSPORT_KV

# 2. Paste your REGISTRY_ADDRESS into wrangler.toml, then upload your 3 private secrets:
npx wrangler secret put ATTESTOR_KEY
npx wrangler secret put RELAYER_KEY
npx wrangler secret put PEPPER_SALT

# 3. Deploy live
npx wrangler deploy
```

After `npx wrangler deploy` prints your worker URL (for example `https://canon-passport-worker.<your-subdomain>.workers.dev`), set `PASSPORT_API` in your CANON web app environment to that URL.
