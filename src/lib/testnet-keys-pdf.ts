export type TestnetPdfDeployment = {
  chainId?: number;
  tokenName?: string;
  tokenSymbol?: string;
  pnth?: string;
  pnthRouter?: string;
  indexVault?: string;
  staking?: string;
  constituentRegistry?: string;
  passportRegistry?: string;
  drip?: string;
  usdc?: string;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 40;
const CONTENT_W = PAGE_W - MARGIN_X * 2; // 532pt

type Rgb = readonly [number, number, number];

const COLORS = {
  obsidian: [0.045, 0.058, 0.086] as Rgb,
  ink: [0.06, 0.08, 0.12] as Rgb,
  slate: [0.33, 0.38, 0.46] as Rgb,
  muted: [0.47, 0.52, 0.6] as Rgb,
  line: [0.87, 0.89, 0.92] as Rgb,
  well: [0.965, 0.973, 0.984] as Rgb,
  emeraldBg: [0.925, 0.985, 0.955] as Rgb,
  emeraldInk: [0.02, 0.47, 0.33] as Rgb,
  white: [1, 1, 1] as Rgb,
  softWhite: [0.76, 0.81, 0.88] as Rgb,
  mintAccent: [0.32, 0.92, 0.68] as Rgb,
};

function sanitizePdfText(raw: string): string {
  return raw
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    .replace(/·/g, "|")
    .replace(/≈/g, "~")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function fmtRgb(c: Rgb): string {
  return `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)}`;
}

function topY(yFromTop: number): number {
  return Number((PAGE_H - yFromTop).toFixed(2));
}

function wrapWords(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxChars) {
      current = `${current} ${w}`;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

class PdfPageCanvas {
  private ops: string[] = [];

  rectFill(x: number, yTop: number, w: number, h: number, fill: Rgb) {
    const y = topY(yTop + h);
    this.ops.push(`${fmtRgb(fill)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  rectStroke(x: number, yTop: number, w: number, h: number, stroke: Rgb, lineWidth = 0.75) {
    const y = topY(yTop + h);
    this.ops.push(
      `${lineWidth.toFixed(2)} w ${fmtRgb(stroke)} RG ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`,
    );
  }

  rectFillStroke(x: number, yTop: number, w: number, h: number, fill: Rgb, stroke: Rgb, lineWidth = 0.75) {
    const y = topY(yTop + h);
    this.ops.push(
      `${lineWidth.toFixed(2)} w ${fmtRgb(fill)} rg ${fmtRgb(stroke)} RG ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re B`,
    );
  }

  hline(x: number, yTop: number, w: number, stroke: Rgb = COLORS.line, lineWidth = 0.6) {
    const y = topY(yTop);
    this.ops.push(
      `${lineWidth.toFixed(2)} w ${fmtRgb(stroke)} RG ${x.toFixed(2)} ${y.toFixed(2)} m ${(x + w).toFixed(2)} ${y.toFixed(2)} l S`,
    );
  }

  text(
    str: string,
    x: number,
    yTopBaseline: number,
    opts: { font?: "F1" | "F2" | "F3"; size?: number; color?: Rgb } = {},
  ) {
    const font = opts.font ?? "F2";
    const size = opts.size ?? 9.5;
    const color = opts.color ?? COLORS.ink;
    const y = topY(yTopBaseline);
    const clean = sanitizePdfText(str);
    this.ops.push(`BT /${font} ${size.toFixed(2)} Tf ${fmtRgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${clean}) Tj ET`);
  }

  paragraph(
    str: string,
    x: number,
    yTopStart: number,
    maxChars: number,
    lineHeight: number,
    opts: { font?: "F1" | "F2" | "F3"; size?: number; color?: Rgb } = {},
  ): number {
    const lines = wrapWords(str, maxChars);
    let y = yTopStart;
    for (const line of lines) {
      this.text(line, x, y, opts);
      y += lineHeight;
    }
    return y;
  }

  footer(pageNum: number, totalPages: number) {
    this.hline(MARGIN_X, PAGE_H - 42, CONTENT_W, COLORS.line, 0.6);
    this.text(
      "CANON  |  Elysium Testnet (Chain ID 99801)  |  100% Free Stack ($0.00/mo)",
      MARGIN_X,
      PAGE_H - 27,
      { font: "F2", size: 8, color: COLORS.muted },
    );
    this.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN_X - 52, PAGE_H - 27, {
      font: "F1",
      size: 8,
      color: COLORS.slate,
    });
  }

  subPageHeader(subtitle: string, pageNum: number, totalPages: number) {
    this.rectFill(0, 0, PAGE_W, 46, COLORS.obsidian);
    this.text("CANON", MARGIN_X, 28, { font: "F1", size: 13, color: COLORS.white });
    this.text(subtitle, MARGIN_X + 58, 28, { font: "F2", size: 9.5, color: COLORS.softWhite });
    this.text(`$0.00 / MO  |  P.${pageNum}/${totalPages}`, PAGE_W - MARGIN_X - 96, 28, {
      font: "F3",
      size: 8.5,
      color: COLORS.mintAccent,
    });
  }

  sectionHeading(index: string, title: string, rightNote: string, yTop: number): number {
    this.text(`${index}. ${title}`, MARGIN_X, yTop, { font: "F1", size: 11.5, color: COLORS.ink });
    if (rightNote) {
      const approxW = rightNote.length * 4.9;
      this.text(rightNote, PAGE_W - MARGIN_X - approxW, yTop, {
        font: "F3",
        size: 8.5,
        color: COLORS.emeraldInk,
      });
    }
    this.hline(MARGIN_X, yTop + 6, CONTENT_W, COLORS.ink, 1.0);
    return yTop + 18;
  }

  stream(): string {
    return this.ops.join("\n");
  }
}

function drawKeyRow(
  p: PdfPageCanvas,
  yTop: number,
  item: {
    keyName: string;
    provider: string;
    urlOrTarget: string;
    summary: string;
    quotaLine: string;
    costLabel: string;
  },
): number {
  const summaryLines = wrapWords(item.summary, 92);
  const boxH = 44 + summaryLines.length * 11.5;

  p.rectFillStroke(MARGIN_X, yTop, CONTENT_W, boxH, COLORS.well, COLORS.line, 0.6);

  // Top line: Key Name + Provider + Cost pill
  p.text(item.keyName, MARGIN_X + 10, yTop + 14, { font: "F3", size: 9.5, color: COLORS.ink });
  const providerX = MARGIN_X + 14 + Math.max(item.keyName.length * 5.8, 130);
  p.text(item.provider, providerX, yTop + 14, { font: "F1", size: 9, color: COLORS.slate });

  const pillW = 74;
  const pillX = PAGE_W - MARGIN_X - pillW - 8;
  p.rectFill(pillX, yTop + 5, pillW, 14, COLORS.emeraldBg);
  p.text(item.costLabel, pillX + 8, yTop + 14.5, { font: "F3", size: 8.2, color: COLORS.emeraldInk });

  // URL / Target line
  p.text(item.urlOrTarget, MARGIN_X + 10, yTop + 26.5, { font: "F3", size: 8, color: COLORS.slate });

  // Plain-language explanation
  let curY = yTop + 39;
  for (const line of summaryLines) {
    p.text(line, MARGIN_X + 10, curY, { font: "F2", size: 8.8, color: COLORS.ink });
    curY += 11.5;
  }

  // Quota & usage line
  p.text(item.quotaLine, MARGIN_X + 10, curY + 1, { font: "F1", size: 8, color: COLORS.emeraldInk });

  return yTop + boxH + 7;
}

export function buildTestnetKeysPdf(dep?: Partial<TestnetPdfDeployment>): Uint8Array {
  const sym = dep?.tokenSymbol || "CANON";
  const totalPages = 3;

  // =========================================================================
  // PAGE 1: EXECUTIVE $0 ROLLUP + FREE EXTERNAL ACCOUNT SIGNUPS
  // =========================================================================
  const p1 = new PdfPageCanvas();

  // Hero Obsidian Banner
  p1.rectFill(0, 0, PAGE_W, 88, COLORS.obsidian);
  p1.text(`$${sym} TESTNET KEYS & $0 COST GUIDE`, MARGIN_X, 34, {
    font: "F1",
    size: 17.5,
    color: COLORS.white,
  });
  p1.text(
    "Full list of API keys, free public RPCs, worker keys & usage limits for Elysium Testnet (Chain 99801)",
    MARGIN_X,
    52,
    { font: "F2", size: 9.2, color: COLORS.softWhite },
  );
  p1.text("Prepared for Founders, Crowdfunders & Grant Reviewers  |  Zero Paid Subscriptions Needed", MARGIN_X, 68, {
    font: "F2",
    size: 8.3,
    color: COLORS.mintAccent,
  });

  // Top-right $0.00 callout inside Hero
  p1.rectFill(PAGE_W - MARGIN_X - 118, 18, 118, 30, [0.09, 0.2, 0.16]);
  p1.text("EST. LIVE BILL", PAGE_W - MARGIN_X - 108, 30, { font: "F1", size: 7.2, color: COLORS.softWhite });
  p1.text("$0.00 / MO", PAGE_W - MARGIN_X - 108, 42.5, { font: "F3", size: 11, color: COLORS.mintAccent });

  // 4-Column Metric Strip
  const statY = 102;
  const statGap = 8;
  const statW = (CONTENT_W - statGap * 3) / 4;
  const stats = [
    { k: "TOTAL MONTHLY BILL", v: "$0.00 / mo", sub: "100% permanent free tiers" },
    { k: "EXTERNAL SIGNUPS", v: "2 Free IDs", sub: "Reown + Cloudflare Free" },
    { k: "ZERO-KEY PUBLIC URLS", v: "5 Endpoints", sub: "RPCs, Faucet & HL Info" },
    { k: "1-TAP LOCAL KEYS", v: "4 Hex Keys", sub: "Made free inside app" },
  ];
  stats.forEach((s, idx) => {
    const sx = MARGIN_X + idx * (statW + statGap);
    p1.rectFillStroke(sx, statY, statW, 48, COLORS.well, COLORS.line, 0.6);
    p1.text(s.k, sx + 8, statY + 13, { font: "F1", size: 7.2, color: COLORS.muted });
    p1.text(s.v, sx + 8, statY + 29, { font: "F1", size: 12.5, color: COLORS.ink });
    p1.text(s.sub, sx + 8, statY + 41, { font: "F2", size: 7.6, color: COLORS.slate });
  });

  let y1 = p1.sectionHeading(
    "01",
    "Free Account Signups (Only 2 Free Accounts Required)",
    "SUBTOTAL: $0.00 / MO",
    170,
  );

  y1 = drawKeyRow(p1, y1, {
    keyName: "VITE_WC_PROJECT_ID",
    provider: "Reown Cloud (WalletConnect)",
    urlOrTarget: "Signup (Free): https://dashboard.reown.com  ->  Create Project  ->  Copy Project ID",
    summary:
      "Pairs mobile & desktop wallets (MetaMask, Rabby, Rainbow, Trust) via QR or phone deep link. CANON already includes a working preview ID out of the box; grab your own free ID when hosting on your custom domain.",
    quotaLine:
      "Free Limit: 1,000,000 relay msgs/mo  |  Est. Testnet Usage: ~3,000 - 12,000 msgs/mo (<1.2% used)",
    costLabel: "$0.00 / mo",
  });

  y1 = drawKeyRow(p1, y1, {
    keyName: "CLOUDFLARE + KV IDS",
    provider: "Cloudflare Workers & KV (Free Plan)",
    urlOrTarget: "Signup (Free): https://dash.cloudflare.com/sign-up  (No server or credit card needed)",
    summary:
      "Hosts two zero-server workers: canon-passport-worker (checks Hyperliquid history & sponsors gasless HYPE Pass mints) and canon-keeper-worker (runs every 5 min to lock swap fees & buy the top 10 clean coins). Create PASSPORT_KV and KEEPER_KV via npx wrangler kv namespace create.",
    quotaLine:
      "Free Limit: 100k req/day + 100k KV reads/day + 5 Crons  |  Est. Usage: ~400 - 800 req/day (<1% used)",
    costLabel: "$0.00 / mo",
  });

  y1 = drawKeyRow(p1, y1, {
    keyName: "GITHUB ACTIONS CRON",
    provider: "Optional Backup to Cloudflare Keeper",
    urlOrTarget: "Included Workflow: .github/workflows/canon-keeper-cron.yml  (https://github.com)",
    summary:
      "Optional backup if you prefer GitHub over Cloudflare for the 5-minute keeper loop. Add KEEPER_KEY and CANON_DEPLOYMENT_JSON in GitHub Repo Settings -> Actions Variables & Secrets.",
    quotaLine:
      "Free Limit: Unlimited minutes on public repos (2,000 min/mo private)  |  Est. Cost: $0.00",
    costLabel: "$0.00 / mo",
  });

  // Important Zero-AI Cost Callout Box
  p1.rectFillStroke(MARGIN_X, y1 + 4, CONTENT_W, 54, COLORS.emeraldBg, COLORS.line, 0.6);
  p1.text("GOOD TO KNOW: ZERO PAID AI OR RPC KEYS NEEDED", MARGIN_X + 10, y1 + 19, {
    font: "F1",
    size: 9.2,
    color: COLORS.emeraldInk,
  });
  p1.paragraph(
    "You will see GEMINI_API_KEY listed as a blank template line inside .env.example from the studio host. Leave it blank - CANON does not call any paid AI APIs. All coin checks (Lens), basket math, swaps, staking, and votes run directly on free public chain data.",
    MARGIN_X + 10,
    y1 + 32,
    94,
    11,
    { font: "F2", size: 8.5, color: COLORS.ink },
  );

  p1.footer(1, totalPages);

  // =========================================================================
  // PAGE 2: ZERO-KEY PUBLIC ENDPOINTS + 1-TAP SELF-GENERATED WALLET KEYS
  // =========================================================================
  const p2 = new PdfPageCanvas();
  p2.subPageHeader("Public Zero-Key Endpoints & Local 1-Tap Worker Keys", 2, totalPages);

  let y2 = p2.sectionHeading(
    "02",
    "Public Blockchain & Data Endpoints (Zero Signup, No Key)",
    "SUBTOTAL: $0.00 / MO",
    68,
  );

  const publicEndpoints = [
    {
      name: "VITE_RPC_URL / ELYSIUM_RPC",
      url: "https://testnet-rpc.elysium.kinetiq.xyz",
      desc: "Official Elysium Testnet (Chain 99801) JSON-RPC for deploying contracts, trading, staking & ballots.",
      limit: "Public free RPC  |  Est. 5k - 25k calls/mo  |  $0.00/mo",
    },
    {
      name: "Elysium Test HYPE Faucet",
      url: "https://elysium.kinetiq.xyz/testnet-faucet",
      desc: "Free Test HYPE gas drip. ~0.02 Test HYPE deploys all 8 contracts; ~0.10 Test HYPE funds 5,000+ worker runs.",
      limit: "Official daily free drip  |  $0.00",
    },
    {
      name: "Ascend Test USDC Mint",
      url: dep?.usdc || "0x4b4fb5C5794F0c821464956374cC5872D5F0f140",
      desc: "Open mint() token on Elysium 99801 called automatically during Guided Seed to mint 500 Test USDC.",
      limit: "Unlimited free testnet mints  |  $0.00",
    },
    {
      name: "HYPEREVM_RPC",
      url: "https://rpc.hyperliquid.xyz/evm",
      desc: "Public HyperEVM read RPC used by canon-passport-worker to read HYPE, kHYPE, WHYPE & KNTQ balances.",
      limit: "Public read-only RPC  |  Cached 7 days in KV  |  $0.00/mo",
    },
    {
      name: "HL_INFO_URL",
      url: "https://api.hyperliquid.xyz/info",
      desc: "Public Hyperliquid L1 info endpoint used to score real user trading & staking history for 1-person-1-vote.",
      limit: "Public REST endpoint  |  Zero API key required  |  $0.00/mo",
    },
  ];

  for (const ep of publicEndpoints) {
    p2.rectFillStroke(MARGIN_X, y2, CONTENT_W, 44, COLORS.well, COLORS.line, 0.55);
    p2.text(ep.name, MARGIN_X + 10, y2 + 13, { font: "F1", size: 9, color: COLORS.ink });
    p2.text(ep.url, MARGIN_X + 185, y2 + 13, { font: "F3", size: 8, color: COLORS.slate });
    p2.text(ep.desc, MARGIN_X + 10, y2 + 26, { font: "F2", size: 8.3, color: COLORS.ink });
    p2.text(ep.limit, MARGIN_X + 10, y2 + 37.5, { font: "F3", size: 7.7, color: COLORS.emeraldInk });
    y2 += 49;
  }

  y2 = p2.sectionHeading(
    "03",
    "Local Wallet Keys (Made Free in 1 Tap Inside Launch $CANON)",
    "SUBTOTAL: $0.00 / MO",
    y2 + 10,
  );

  p2.text(
    "Open Launch $CANON -> Full Controls -> Workers -> Create Fresh Worker Keys to make all 4 keys offline for free:",
    MARGIN_X,
    y2 - 2,
    { font: "F2", size: 8.6, color: COLORS.slate },
  );
  y2 += 10;

  const localKeys = [
    {
      k: "ATTESTOR_KEY",
      where: "canon-passport-worker",
      note: "32-byte hex key that signs verified HYPE Pass tier approvals. Uses 0 gas. Cost: $0.00.",
    },
    {
      k: "RELAYER_KEY",
      where: "canon-passport-worker",
      note: "Pays free Test HYPE gas so users mint HYPE Passes for free. Fund once with ~0.05 Test HYPE. Cost: $0.00.",
    },
    {
      k: "PEPPER_SALT",
      where: "canon-passport-worker",
      note: "Random 32-byte hex salt so users' main Hyperliquid wallets stay private on-chain. Cost: $0.00.",
    },
    {
      k: "KEEPER_KEY",
      where: "canon-keeper-worker",
      note: "Runs pnthRouter.run() & indexVault.rebalance() every 5 min. Fund once with ~0.05 Test HYPE. Cost: $0.00.",
    },
    {
      k: "TRIGGER_TOKEN (Opt.)",
      where: "canon-keeper-worker",
      note: "Optional random password you pick if triggering POST /run manually over HTTP. Cost: $0.00.",
    },
    {
      k: "DEPLOYER_KEY (Opt.)",
      where: "CLI deploy only",
      note: "NOT needed for phone wallet Guided Launch. Only used if running npm run testnet:deploy on PC. Cost: $0.00.",
    },
  ];

  for (const lk of localKeys) {
    p2.rectFillStroke(MARGIN_X, y2, CONTENT_W, 33, COLORS.well, COLORS.line, 0.55);
    p2.text(lk.k, MARGIN_X + 10, y2 + 13, { font: "F3", size: 8.8, color: COLORS.ink });
    p2.text(`Target: ${lk.where}`, MARGIN_X + 165, y2 + 13, { font: "F1", size: 8.2, color: COLORS.slate });
    p2.text("$0.00", PAGE_W - MARGIN_X - 38, y2 + 13, { font: "F3", size: 8.5, color: COLORS.emeraldInk });
    p2.text(lk.note, MARGIN_X + 10, y2 + 25.5, { font: "F2", size: 8.2, color: COLORS.ink });
    y2 += 38;
  }

  p2.footer(2, totalPages);

  // =========================================================================
  // PAGE 3: EXACT WIRING MAP + LIVE CONTRACT SHEET + 4-STEP GO-LIVE ORDER
  // =========================================================================
  const p3 = new PdfPageCanvas();
  p3.subPageHeader(`Wiring Checklist & Active $${sym} Contract Sheet`, 3, totalPages);

  let y3 = p3.sectionHeading("04", "Where Every Variable Goes (Quick Wiring Table)", "ALL FREE ($0.00)", 68);

  const wiringRows = [
    {
      target: "1. Web App & Server (.env)",
      vars: "VITE_WC_PROJECT_ID, VITE_RPC_URL, PASSPORT_API, APP_URL",
      how: "Set VITE_WC_PROJECT_ID (Reown ID) + PASSPORT_API (your deployed canon-passport-worker *.workers.dev URL).",
    },
    {
      target: "2. workers/passport-worker",
      vars: "REGISTRY_ADDRESS, PASSPORT_KV, ATTESTOR_KEY, RELAYER_KEY, PEPPER_SALT",
      how: "Paste REGISTRY_ADDRESS + KV id in wrangler.toml; store the 3 hex values with npx wrangler secret put.",
    },
    {
      target: "3. workers/keeper-worker",
      vars: "CANON_DEPLOYMENT_JSON, KEEPER_KV, KEEPER_KEY",
      how: "Paste exported CANON_DEPLOYMENT_JSON + KV id in wrangler.toml; store KEEPER_KEY with npx wrangler secret put.",
    },
  ];

  for (const row of wiringRows) {
    p3.rectFillStroke(MARGIN_X, y3, CONTENT_W, 46, COLORS.well, COLORS.line, 0.55);
    p3.text(row.target, MARGIN_X + 10, y3 + 13, { font: "F1", size: 9, color: COLORS.ink });
    p3.text("$0.00 / mo", PAGE_W - MARGIN_X - 58, y3 + 13, { font: "F3", size: 8.3, color: COLORS.emeraldInk });
    p3.text(`Vars: ${row.vars}`, MARGIN_X + 10, y3 + 25.5, { font: "F3", size: 7.9, color: COLORS.slate });
    p3.text(row.how, MARGIN_X + 10, y3 + 38, { font: "F2", size: 8.1, color: COLORS.ink });
    y3 += 52;
  }

  y3 = p3.sectionHeading(
    "05",
    `Active $${sym} Elysium 99801 Contracts (Auto-Stamped From App)`,
    "CHAIN ID: 99801",
    y3 + 8,
  );

  const contractRows: Array<[string, string]> = [
    [`$${sym} Index Token (pnth)`, dep?.pnth || "Deploy in Launch $CANON"],
    ["Fee Lock Router (pnthRouter)", dep?.pnthRouter || "Deploy in Launch $CANON"],
    ["10-Coin Index Vault (indexVault)", dep?.indexVault || "Deploy in Launch $CANON"],
    ["Staking Rewards (staking)", dep?.staking || "Deploy in Launch $CANON"],
    ["Basket Registry (constituentRegistry)", dep?.constituentRegistry || "Deploy in Launch $CANON"],
    ["HYPE Pass Registry (passportRegistry)", dep?.passportRegistry || "Deploy in Launch $CANON"],
    [`250 $${sym} Backer Drip Faucet (drip)`, dep?.drip || "Created in Guided Step 3"],
  ];

  p3.rectFillStroke(MARGIN_X, y3, CONTENT_W, contractRows.length * 19 + 10, COLORS.well, COLORS.line, 0.55);
  contractRows.forEach(([label, addr], i) => {
    const ry = y3 + 15 + i * 19;
    p3.text(label, MARGIN_X + 10, ry, { font: "F1", size: 8.5, color: COLORS.ink });
    p3.text(addr, MARGIN_X + 215, ry, { font: "F3", size: 8.2, color: COLORS.slate });
    if (i < contractRows.length - 1) {
      p3.hline(MARGIN_X + 10, ry + 5.5, CONTENT_W - 20, COLORS.line, 0.4);
    }
  });
  y3 += contractRows.length * 19 + 24;

  y3 = p3.sectionHeading("06", "Simple 4-Step Go-Live Order (Mobile First)", "TOTAL: $0.00", y3);

  const steps = [
    "01. Open Launch $CANON -> Guided Launch on your phone, claim free Test HYPE gas, and deploy + seed $CANON ($0).",
    "02. Create a free Reown Project ID at dashboard.reown.com when moving to your own domain ($0).",
    "03. In Full Controls -> Workers, tap Create Fresh Worker Keys, fund Relayer & Keeper with 0.05 Test HYPE, and deploy to Cloudflare Free ($0).",
    "04. Set PASSPORT_API to your Worker URL and tap Copy Live Backer Link to share with crowdfunders & grant teams ($0).",
  ];

  for (const st of steps) {
    y3 = p3.paragraph(st, MARGIN_X + 4, y3, 95, 12.5, { font: "F2", size: 8.7, color: COLORS.ink });
    y3 += 3;
  }

  p3.footer(3, totalPages);

  return compilePdfDocument([p1.stream(), p2.stream(), p3.stream()]);
}

function compilePdfDocument(pageStreams: string[]): Uint8Array {
  // Object IDs:
  // 1: Catalog
  // 2: Pages
  // 3: Font F1 (Helvetica-Bold)
  // 4: Font F2 (Helvetica)
  // 5: Font F3 (Courier-Bold)
  // For each page i (0..N-1):
  //   pageObjId = 6 + i * 2
  //   contentObjId = 7 + i * 2
  const objects: string[] = [];

  const pageObjIds = pageStreams.map((_, i) => 6 + i * 2);

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageStreams.length} >>\nendobj\n`;
  objects[3] = `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[5] = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  pageStreams.forEach((streamContent, i) => {
    const pageId = 6 + i * 2;
    const contentId = 7 + i * 2;
    const byteLen = Buffer.byteLength(streamContent, "latin1");

    objects[pageId] =
      `${pageId} 0 obj\n` +
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>\n` +
      `endobj\n`;

    objects[contentId] =
      `${contentId} 0 obj\n` +
      `<< /Length ${byteLen} >>\n` +
      `stream\n${streamContent}\nendstream\n` +
      `endobj\n`;
  });

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += objects[id];
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += `0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }

  pdf +=
    `trailer\n` +
    `<< /Size ${objects.length} /Root 1 0 R >>\n` +
    `startxref\n` +
    `${xrefOffset}\n` +
    `%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}
