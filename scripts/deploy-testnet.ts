import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  erc20Abi,
  formatUnits,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  pad,
  parseAbi,
  toBytes,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ROUND4_CLEAN_BASKET,
  ROUND4_METHODOLOGY_URI,
  ROUND4_SCORE_ROOT,
} from "../src/lib/chain/round4-basket.ts";
import {
  canonSwapperArtifact,
  canonTestnetAmmArtifact,
  constituentRegistryArtifact,
  covenantFactoryArtifact,
  hypePassportRegistryArtifact,
  indexVaultArtifact,
  pantheonStakingArtifact,
  testDripArtifact,
} from "../src/lib/chain/testnet-artifacts.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const RPC_URL =
  process.env.RPC_URL ||
  process.env.VITE_RPC_URL ||
  "https://testnet-rpc.elysium.kinetiq.xyz";

const ASCEND_LAUNCHPAD: Address = "0xE2f6254508DEB93Da081837F545e0bAF7b00d8E9";
const ASCEND_VAULT: Address = "0x2B738A9A69b7a45C9dA6B519f6bE6efBfb912aec";
const ASCEND_PM: Address = "0x12E84206cB53aE0df055482ebc4658635096E1aA";
const TESTNET_USDC: Address = "0x4b4fb5C5794F0c821464956374cC5872D5F0f140";
const BURN_SINK: Address = "0xC889ac2f59A88afb3B2FB3f2C452DBa336fE5f0F";

const elysium = defineChain({
  id: 99801,
  name: "Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  testnet: true,
});

const PAUSED_ABI = parseAbi(["function paused() view returns (bool)"]);
const MINT_USDC_ABI = parseAbi(["function mint(address to, uint256 value)"]);

const DYNAMIC_FEE = 0x800000;
const POOL_PARAMETERS = pad(toHex(0x0445 | (200 << 16)), { size: 32 });

function buildPoolKey(token: Address, quote: Address, launchpad: Address, poolManager: Address) {
  const tokenIs0 = BigInt(token) < BigInt(quote);
  return {
    currency0: tokenIs0 ? token : quote,
    currency1: tokenIs0 ? quote : token,
    hooks: launchpad,
    poolManager,
    fee: DYNAMIC_FEE,
    parameters: POOL_PARAMETERS,
  } as const;
}

async function main() {
  const rawKey = process.env.DEPLOYER_KEY?.trim() as Hex | undefined;
  if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
    console.error("Missing DEPLOYER_KEY=0x... environment variable.");
    console.error("Tip: You can also launch directly from your browser or phone wallet in Testnet Studio (/testnet).");
    process.exit(1);
  }

  const account = privateKeyToAccount(rawKey);
  const attestor = getAddress((process.env.ATTESTOR || account.address) as Address);
  const guardian = getAddress((process.env.GUARDIAN || account.address) as Address);
  const curator = getAddress((process.env.CURATOR || account.address) as Address);
  const team = getAddress((process.env.TEAM || account.address) as Address);
  const teamBps = Number(process.env.TEAM_BPS || "1500");
  const tokenName = (process.env.TOKEN_NAME || "CANON").trim();
  const tokenSymbol = (process.env.TOKEN_SYMBOL || "CANON").trim();

  if (!Number.isInteger(teamBps) || teamBps < 0 || teamBps > 5000) {
    throw new Error("TEAM_BPS must be an integer between 0 and 5000 (1500 = 15%).");
  }
  const indexAndBurnBps = 10_000 - teamBps;

  const publicClient = createPublicClient({
    chain: elysium,
    transport: http(RPC_URL, { timeout: 20_000 }),
  });
  const walletClient = createWalletClient({
    account,
    chain: elysium,
    transport: http(RPC_URL, { timeout: 20_000 }),
  });

  const hypeBal = await publicClient.getBalance({ address: account.address });
  const startBlock = await publicClient.getBlockNumber();
  console.log(`Deploying ${tokenName} ($${tokenSymbol}) on Elysium Testnet (99801)`);
  console.log(`Deployer:  ${account.address} (${formatUnits(hypeBal, 18)} HYPE)`);
  console.log(`Fee Split: ${(indexAndBurnBps / 100).toFixed(2)}% Vault & Burn · ${(teamBps / 100).toFixed(2)}% Team (${team})`);

  if (hypeBal === 0n) {
    throw new Error("Deployer wallet has 0 Test HYPE. Claim free gas at https://elysium.kinetiq.xyz/testnet-faucet");
  }

  const ascendPaused = await publicClient
    .readContract({
      address: ASCEND_LAUNCHPAD,
      abi: PAUSED_ABI,
      functionName: "paused",
    })
    .catch(() => true);

  let canonLaunchpad: Address = ASCEND_LAUNCHPAD;
  if (ascendPaused) {
    console.log("Ascend shared testnet launchpad has new launches paused; deploying open CanonTestnetAmm for $CANON pool...");
    const ammHash = await walletClient.deployContract({
      abi: canonTestnetAmmArtifact.abi,
      bytecode: canonTestnetAmmArtifact.bytecode,
      args: [TESTNET_USDC],
    });
    const ammRec = await publicClient.waitForTransactionReceipt({ hash: ammHash });
    if (!ammRec.contractAddress) throw new Error("CanonTestnetAmm deploy failed");
    canonLaunchpad = getAddress(ammRec.contractAddress);
    console.log(`  ✓ CanonTestnetAmm:       ${canonLaunchpad}`);
  }

  // 1. HypePassportRegistry
  const passHash = await walletClient.deployContract({
    abi: hypePassportRegistryArtifact.abi,
    bytecode: hypePassportRegistryArtifact.bytecode,
    args: [attestor, guardian],
  });
  const passRec = await publicClient.waitForTransactionReceipt({ hash: passHash });
  const passportRegistry = getAddress(passRec.contractAddress!);
  console.log(`  ✓ HypePassportRegistry:  ${passportRegistry}`);

  // 2. CovenantFactory
  const facHash = await walletClient.deployContract({
    abi: covenantFactoryArtifact.abi,
    bytecode: covenantFactoryArtifact.bytecode,
    args: [canonLaunchpad, BURN_SINK],
  });
  const facRec = await publicClient.waitForTransactionReceipt({ hash: facHash });
  const covenantFactory = getAddress(facRec.contractAddress!);
  console.log(`  ✓ CovenantFactory:       ${covenantFactory}`);

  // 3. Deterministic IndexVault prediction at nonce + 3:
  //    nonce + 0 -> CovenantFactory.launch
  //    nonce + 1 -> ConstituentRegistry
  //    nonce + 2 -> PantheonStaking
  //    nonce + 3 -> IndexVault
  const launchNonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  const predictedVault = getAddress(
    getContractAddress({
      from: account.address,
      nonce: BigInt(launchNonce) + 3n,
    }),
  );
  console.log(`  · Predicted IndexVault:  ${predictedVault} (nonce ${launchNonce + 3})`);

  const tokenLegs =
    teamBps > 0
      ? [
          { job: 1, bps: indexAndBurnBps, target: zeroAddress },
          { job: 0, bps: teamBps, target: team },
        ]
      : [{ job: 1, bps: 10_000, target: zeroAddress }];

  const quoteLegs =
    teamBps > 0
      ? [
          { job: 2, bps: indexAndBurnBps, target: predictedVault },
          { job: 0, bps: teamBps, target: team },
        ]
      : [{ job: 2, bps: 10_000, target: predictedVault }];

  const salt = keccak256(toBytes(`canon:${account.address}:${Date.now()}`));
  const launchHash = await walletClient.writeContract({
    address: covenantFactory,
    abi: covenantFactoryArtifact.abi,
    functionName: "launch",
    args: [tokenName, tokenSymbol, TESTNET_USDC, salt, tokenLegs, quoteLegs],
  });
  const launchRec = await publicClient.waitForTransactionReceipt({ hash: launchHash });

  let pnth: Address | null = null;
  let pnthPool: Hex | null = null;
  let pnthRouter: Address | null = null;

  for (const log of launchRec.logs) {
    try {
      const decoded = decodeEventLog({
        abi: covenantFactoryArtifact.abi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "RouterDeployed") {
        pnth = getAddress(decoded.args.token);
        pnthPool = decoded.args.poolId;
        pnthRouter = getAddress(decoded.args.router);
        break;
      }
    } catch {
      // Ignore other logs
    }
  }
  if (!pnth || !pnthPool || !pnthRouter) {
    throw new Error("Could not decode RouterDeployed event from launch receipt.");
  }
  console.log(`  ✓ $${tokenSymbol} Token:         ${pnth}`);
  console.log(`  ✓ $${tokenSymbol} PoolId:        ${pnthPool}`);
  console.log(`  ✓ CovenantRouter:        ${pnthRouter}`);

  // 4. ConstituentRegistry (wired to Ascend's 10 live Round 4 pools)
  const regHash = await walletClient.deployContract({
    abi: constituentRegistryArtifact.abi,
    bytecode: constituentRegistryArtifact.bytecode,
    args: [ASCEND_LAUNCHPAD, TESTNET_USDC, pnth, curator, guardian, 100_000_000n],
  });
  const regRec = await publicClient.waitForTransactionReceipt({ hash: regHash });
  const constituentRegistry = getAddress(regRec.contractAddress!);
  console.log(`  ✓ ConstituentRegistry:   ${constituentRegistry}`);

  // 5. PantheonStaking
  const stkHash = await walletClient.deployContract({
    abi: pantheonStakingArtifact.abi,
    bytecode: pantheonStakingArtifact.bytecode,
    args: [pnth, passportRegistry, constituentRegistry],
  });
  const stkRec = await publicClient.waitForTransactionReceipt({ hash: stkHash });
  const staking = getAddress(stkRec.contractAddress!);
  console.log(`  ✓ PantheonStaking:       ${staking}`);

  // 6. IndexVault (365-day maxStale window on testnet so quiet testnet days never skip basket buys)
  const vltHash = await walletClient.deployContract({
    abi: indexVaultArtifact.abi,
    bytecode: indexVaultArtifact.bytecode,
    args: [ASCEND_LAUNCHPAD, constituentRegistry, staking, BigInt(365 * 86_400)],
  });
  const vltRec = await publicClient.waitForTransactionReceipt({ hash: vltHash });
  const indexVault = getAddress(vltRec.contractAddress!);
  console.log(`  ✓ IndexVault:            ${indexVault}`);

  if (indexVault.toLowerCase() !== predictedVault.toLowerCase()) {
    throw new Error(`IndexVault address mismatch: deployed ${indexVault}, expected ${predictedVault}`);
  }

  // 7. CanonSwapper + Initial Seed Buy + TestDrip
  const swpHash = await walletClient.deployContract({
    abi: canonSwapperArtifact.abi,
    bytecode: canonSwapperArtifact.bytecode,
    args: [ASCEND_VAULT, ASCEND_PM],
  });
  const swpRec = await publicClient.waitForTransactionReceipt({ hash: swpHash });
  const swapper = getAddress(swpRec.contractAddress!);
  console.log(`  ✓ CanonSwapper:          ${swapper}`);

  const seedUsdc = 500_000_000n; // 500 Test USDC
  const mintHash = await walletClient.writeContract({
    address: TESTNET_USDC,
    abi: MINT_USDC_ABI,
    functionName: "mint",
    args: [account.address, seedUsdc],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });

  const appHash = await walletClient.writeContract({
    address: TESTNET_USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [swapper, seedUsdc],
  });
  await publicClient.waitForTransactionReceipt({ hash: appHash });

  const poolManager: Address = ascendPaused ? canonLaunchpad : ASCEND_PM;
  const poolKey = buildPoolKey(pnth, TESTNET_USDC, canonLaunchpad, poolManager);
  const zeroForOne = BigInt(TESTNET_USDC) < BigInt(pnth);

  const buyHash = await walletClient.writeContract({
    address: swapper,
    abi: canonSwapperArtifact.abi,
    functionName: "swapExactIn",
    args: [poolKey, zeroForOne, seedUsdc],
  });
  await publicClient.waitForTransactionReceipt({ hash: buyHash });

  const boughtCanon = await publicClient.readContract({
    address: pnth,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`  ✓ Seeded pool w/ 500 USDC -> received ${formatUnits(boughtCanon, 18)} $${tokenSymbol}`);

  const dripHash = await walletClient.deployContract({
    abi: testDripArtifact.abi,
    bytecode: testDripArtifact.bytecode,
    args: [pnth, 250n * 10n ** 18n],
  });
  const dripRec = await publicClient.waitForTransactionReceipt({ hash: dripHash });
  const drip = getAddress(dripRec.contractAddress!);

  if (boughtCanon > 1_000n * 10n ** 18n) {
    const fundAmount = boughtCanon / 2n;
    const fundHash = await walletClient.writeContract({
      address: pnth,
      abi: erc20Abi,
      functionName: "transfer",
      args: [drip, fundAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log(`  ✓ TestDrip (${drip}) funded with ${formatUnits(fundAmount, 18)} $${tokenSymbol}`);
  }

  // 8. Propose 10-Coin Clean Basket on ConstituentRegistry (if deployer == curator)
  if (curator.toLowerCase() === account.address.toLowerCase()) {
    const propHash = await walletClient.writeContract({
      address: constituentRegistry,
      abi: constituentRegistryArtifact.abi,
      functionName: "propose",
      args: [
        ROUND4_CLEAN_BASKET.map((c) => ({
          poolId: c.poolId,
          token: c.token,
          weightBps: c.weightBps,
          perRunCap: c.perRunCap,
        })),
        ROUND4_SCORE_ROOT,
        ROUND4_METHODOLOGY_URI,
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: propHash });
    console.log("  ✓ Proposed 10-coin clean Round 4 basket (executes after 24h timelock)");
  }

  const outDeployment = {
    chainId: 99801,
    launchpad: canonLaunchpad,
    ascendLaunchpad: ASCEND_LAUNCHPAD,
    usdc: TESTNET_USDC,
    burnSink: BURN_SINK,
    passportRegistry,
    covenantFactory,
    pnth,
    pnthPool,
    pnthRouter,
    constituentRegistry,
    staking,
    indexVault,
    swapper,
    drip,
    team,
    teamBps,
    tokenName,
    tokenSymbol,
    customActive: true,
    deployedBlock: startBlock.toString(),
    activatedAt: new Date().toISOString(),
  };

  const outPath = path.join(ROOT, "src/data/deployments/active-deployment.json");
  await fs.writeFile(outPath, `${JSON.stringify(outDeployment, null, 2)}\n`, "utf8");
  console.log(`\nSaved live deployment to src/data/deployments/active-deployment.json`);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
