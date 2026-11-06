import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  decodeEventLog,
  encodeDeployData,
  erc20Abi,
  formatUnits,
  getAddress,
  getContractAddress,
  isAddress,
  keccak256,
  pad,
  parseAbi,
  parseEther,
  toBytes,
  toHex,
  zeroAddress,
  type Address,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  useBalance,
  useConfig,
  useConnection,
  useReadContracts,
  useSwitchChain,
} from "wagmi";
import {
  getPublicClient,
  getWalletClient,
  waitForTransactionReceipt,
} from "wagmi/actions";
import {
  ArrowRight,
  ArrowUpRight,
  Check as CheckIcon,
  Copy,
  Download,
  FileText,
  Link2,
  RefreshCw,
} from "lucide-react";
import {
  constituentRegistryAbi,
  covenantRouterAbi,
  indexVaultAbi,
} from "@/lib/chain/abi";
import {
  activateCustomDeployment,
  ASCEND_TESTNET_LAUNCHPAD,
  ASCEND_TESTNET_USDC,
  buildBackerShareUrl,
  deployment,
  elysium,
  ELYSIUM_BURN_SINK,
  ensureElysiumNetwork,
  explorer,
  isCustomCanonActive,
  resetToSharedDeployment,
  useDeploymentVersion,
} from "@/lib/chain/config";
import type { Deployment } from "@/lib/chain/deployments";
import {
  ROUND4_CLEAN_BASKET,
  ROUND4_METHODOLOGY_URI,
  ROUND4_SCORE_ROOT,
} from "@/lib/chain/round4-basket";
import {
  canonSwapperArtifact,
  canonTestnetAmmArtifact,
  constituentRegistryArtifact,
  covenantFactoryArtifact,
  hypePassportRegistryArtifact,
  indexVaultArtifact,
  pantheonStakingArtifact,
  testDripArtifact,
} from "@/lib/chain/testnet-artifacts";
import { CodeScramble } from "./code-art";
import {
  fmt,
  plainReason,
  SegmentedControl,
  short,
  TxFeedback,
  until,
  useChainNow,
  type Hex,
} from "./shared";
import { BottomSheet } from "./sheet";
import { YoyoVerifyStage } from "./yoyo-eye";

const FAUCET_URL = "https://elysium.kinetiq.xyz/testnet-faucet";
const ASCEND_VAULT: Address = "0x2B738A9A69b7a45C9dA6B519f6bE6efBfb912aec";
const ASCEND_PM: Address = "0x12E84206cB53aE0df055482ebc4658635096E1aA";

const PAUSED_ABI = parseAbi(["function paused() view returns (bool)"]);
const MINT_USDC_ABI = parseAbi(["function mint(address to, uint256 value)"]);

const DYNAMIC_FEE = 0x800000;
const POOL_PARAMETERS = pad(toHex(0x0445 | (200 << 16)), { size: 32 });

type StudioMode = "guided" | "full";
type StudioTab = "setup" | "launch" | "seed" | "workers";

const STUDIO_MODES: ReadonlyArray<{ id: StudioMode; label: string }> = [
  { id: "guided", label: "Guided Launch" },
  { id: "full", label: "Full Controls" },
];

const STUDIO_TABS: ReadonlyArray<{ id: StudioTab; label: string }> = [
  { id: "setup", label: "Setup" },
  { id: "launch", label: "Launch" },
  { id: "seed", label: "Seed" },
  { id: "workers", label: "Workers" },
];

const TEAM_CUT_PRESETS = [
  { label: "0%", bps: 0 },
  { label: "10%", bps: 1000 },
  { label: "15%", bps: 1500 },
  { label: "20%", bps: 2000 },
] as const;

type GeneratedWorkerBundle = {
  attestorKey: Hex;
  attestorAddress: Address;
  relayerKey: Hex;
  relayerAddress: Address;
  keeperKey: Hex;
  keeperAddress: Address;
  pepperSalt: Hex;
};

type LaunchDraft = {
  owner: Address;
  tokenName: string;
  tokenSymbol: string;
  team: Address;
  teamBps: number;
  attestor: Address;
  curator: Address;
  guardian: Address;
  deployedBlock?: string;
  usedCustomAmm?: boolean;
  launchpad?: Address;
  passportRegistry?: Address;
  covenantFactory?: Address;
  predictedVault?: Address;
  launchNonce?: number;
  pnth?: Address;
  pnthPool?: Hex;
  pnthRouter?: Address;
  constituentRegistry?: Address;
  staking?: Address;
  indexVault?: Address;
  swapper?: Address;
  drip?: Address;
  seededPool?: boolean;
  proposedBasket?: boolean;
};

type WorkerStatusPayload = {
  customActive: boolean;
  passportWorker: {
    configured: boolean;
    online: boolean;
    detail: Record<string, unknown> | null;
  };
  chain: {
    routerRuns: number;
    activeBasketId: number;
    proposalCount: number;
    totalStaked: string;
    vaultUsdcBudget: string;
    attestor: string;
    passportRetired: boolean;
  } | null;
};

function draftStorageKey(addr: string): string {
  return `canon.studio.draft.v1:${addr.toLowerCase()}`;
}

function keysStorageKey(addr: string): string {
  return `canon.studio.keys.v1:${addr.toLowerCase()}`;
}

function randomBytes32Hex(): Hex {
  const buf = new Uint8Array(32);
  window.crypto.getRandomValues(buf);
  return `0x${Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as Hex;
}

function buildPoolKey(
  token: Address,
  quote: Address,
  launchpad: Address,
  poolManager: Address,
) {
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

function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function TestnetStudioSheet({
  open,
  onClose,
  onOpenWallet,
  onOpenTrade,
}: {
  open: boolean;
  onClose: () => void;
  onOpenWallet: () => void;
  onOpenTrade?: () => void;
}) {
  const config = useConfig();
  const qc = useQueryClient();
  const deployVersion = useDeploymentVersion();
  const { address, isConnected, chainId } = useConnection();
  const switchChain = useSwitchChain();
  const now = useChainNow();

  const onChain = isConnected && chainId === elysium.id;
  const me = (address ? getAddress(address) : zeroAddress) as Address;

  const [mode, setMode] = useState<StudioMode>("guided");
  const [tab, setTab] = useState<StudioTab>("setup");
  const [tokenName, setTokenName] = useState("CANON");
  const [tokenSymbol, setTokenSymbol] = useState("CANON");
  const [teamBps, setTeamBps] = useState<number>(1500);
  const [teamInput, setTeamInput] = useState("");
  const [attestorInput, setAttestorInput] = useState("");
  const [curatorInput, setCuratorInput] = useState("");
  const [guardianInput, setGuardianInput] = useState("");

  const [workerKeys, setWorkerKeys] = useState<GeneratedWorkerBundle | null>(null);
  const [draft, setDraft] = useState<LaunchDraft | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [yoyoStage, setYoyoStage] = useState<{
    posture: "scan" | "sign" | "confirm" | "alert";
    label: string;
    sublabel?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<Hex | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Hydrate saved draft and generated worker keys per connected wallet
  useEffect(() => {
    if (!address) return;
    const cleanAddr = getAddress(address);
    setTeamInput((prev) => prev || cleanAddr);
    setAttestorInput((prev) => prev || cleanAddr);
    setCuratorInput((prev) => prev || cleanAddr);
    setGuardianInput((prev) => prev || cleanAddr);

    try {
      const savedDraft = window.localStorage.getItem(draftStorageKey(cleanAddr));
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft) as LaunchDraft;
        setDraft(parsed);
        if (parsed.tokenName) setTokenName(parsed.tokenName);
        if (parsed.tokenSymbol) setTokenSymbol(parsed.tokenSymbol);
        if (typeof parsed.teamBps === "number") setTeamBps(parsed.teamBps);
        if (parsed.team) setTeamInput(parsed.team);
        if (parsed.attestor) setAttestorInput(parsed.attestor);
        if (parsed.curator) setCuratorInput(parsed.curator);
        if (parsed.guardian) setGuardianInput(parsed.guardian);
      } else {
        setDraft(null);
      }
    } catch {
      setDraft(null);
    }

    try {
      const savedKeys = window.localStorage.getItem(keysStorageKey(cleanAddr));
      if (savedKeys) {
        setWorkerKeys(JSON.parse(savedKeys) as GeneratedWorkerBundle);
      } else {
        setWorkerKeys(null);
      }
    } catch {
      setWorkerKeys(null);
    }
  }, [address]);

  const persistDraft = (next: LaunchDraft | null) => {
    setDraft(next);
    if (!address) return;
    try {
      if (next) {
        window.localStorage.setItem(draftStorageKey(address), JSON.stringify(next));
      } else {
        window.localStorage.removeItem(draftStorageKey(address));
      }
    } catch {
      // Storage unavailable
    }
  };

  const hypeBal = useBalance({
    address: me,
    chainId: elysium.id,
    query: { enabled: open && onChain, refetchInterval: 6_000 },
  });

  const relayerBal = useBalance({
    address: workerKeys?.relayerAddress ?? zeroAddress,
    chainId: elysium.id,
    query: { enabled: open && onChain && !!workerKeys, refetchInterval: 8_000 },
  });

  const keeperBal = useBalance({
    address: workerKeys?.keeperAddress ?? zeroAddress,
    chainId: elysium.id,
    query: { enabled: open && onChain && !!workerKeys, refetchInterval: 8_000 },
  });

  const customLive = useMemo(() => {
    void deployVersion;
    return isCustomCanonActive();
  }, [deployVersion]);

  // Target deployment to inspect in Seed & Workers tabs:
  // prefer completed draft if present, otherwise active deployment
  const targetDeployment: Deployment | null = useMemo(() => {
    void deployVersion;
    if (
      draft?.launchpad &&
      draft.passportRegistry &&
      draft.covenantFactory &&
      draft.pnth &&
      draft.pnthPool &&
      draft.pnthRouter &&
      draft.constituentRegistry &&
      draft.staking &&
      draft.indexVault
    ) {
      return {
        chainId: 99801,
        launchpad: draft.launchpad,
        ascendLaunchpad: ASCEND_TESTNET_LAUNCHPAD,
        usdc: ASCEND_TESTNET_USDC,
        burnSink: ELYSIUM_BURN_SINK,
        passportRegistry: draft.passportRegistry,
        covenantFactory: draft.covenantFactory,
        pnth: draft.pnth,
        pnthPool: draft.pnthPool,
        pnthRouter: draft.pnthRouter,
        constituentRegistry: draft.constituentRegistry,
        staking: draft.staking,
        indexVault: draft.indexVault,
        swapper: draft.swapper,
        drip: draft.drip,
        team: draft.team,
        teamBps: draft.teamBps,
        tokenName: draft.tokenName,
        tokenSymbol: draft.tokenSymbol,
        deployedBlock: draft.deployedBlock,
      };
    }
    return deployment;
  }, [draft, deployVersion]);

  const seedReads = useReadContracts({
    contracts: targetDeployment
      ? [
          {
            address: targetDeployment.constituentRegistry,
            abi: constituentRegistryAbi,
            functionName: "proposalCount",
          },
          {
            address: targetDeployment.constituentRegistry,
            abi: constituentRegistryAbi,
            functionName: "activeId",
          },
          {
            address: targetDeployment.usdc,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [targetDeployment.indexVault],
          },
          {
            address: targetDeployment.pnthRouter,
            abi: covenantRouterAbi,
            functionName: "runCount",
          },
        ]
      : [],
    query: { enabled: open && !!targetDeployment, refetchInterval: 8_000 },
  });

  const proposalCount = Number(seedReads.data?.[0]?.result ?? 0n);
  const activeBasketId = Number(seedReads.data?.[1]?.result ?? 0n);
  const vaultUsdcRaw = (seedReads.data?.[2]?.result as bigint | undefined) ?? 0n;
  const routerRuns = Number(seedReads.data?.[3]?.result ?? 0n);

  const latestProposalRead = useReadContracts({
    contracts:
      targetDeployment && proposalCount > 0
        ? [
            {
              address: targetDeployment.constituentRegistry,
              abi: constituentRegistryAbi,
              functionName: "proposal",
              args: [BigInt(proposalCount)],
            },
          ]
        : [],
    query: { enabled: open && !!targetDeployment && proposalCount > 0, refetchInterval: 8_000 },
  });

  const latestProposal = latestProposalRead.data?.[0]?.result?.[0];
  const latestEta = latestProposal ? Number(latestProposal.eta) : 0;
  const latestExecuted = latestProposal?.executed ?? false;
  const latestVetoed = latestProposal?.vetoed ?? false;
  const canExecuteLatest =
    proposalCount > 0 && !latestExecuted && !latestVetoed && latestEta > 0 && now >= latestEta;

  const workerStatus = useQuery<WorkerStatusPayload>({
    queryKey: ["canon-worker-status", deployVersion],
    queryFn: async () => {
      const r = await fetch("/api/workers/status");
      if (!r.ok) throw new Error("Status unavailable");
      return (await r.json()) as WorkerStatusPayload;
    },
    enabled: open && tab === "workers",
    refetchInterval: 12_000,
  });

  const copyText = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
    } catch {
      // Clipboard unavailable
    }
  };

  const createWorkerBundle = (): GeneratedWorkerBundle => {
    const attestorKey = generatePrivateKey();
    const relayerKey = generatePrivateKey();
    const keeperKey = generatePrivateKey();
    const bundle: GeneratedWorkerBundle = {
      attestorKey,
      attestorAddress: privateKeyToAccount(attestorKey).address,
      relayerKey,
      relayerAddress: privateKeyToAccount(relayerKey).address,
      keeperKey,
      keeperAddress: privateKeyToAccount(keeperKey).address,
      pepperSalt: randomBytes32Hex(),
    };
    setWorkerKeys(bundle);
    setAttestorInput(bundle.attestorAddress);
    if (address) {
      try {
        window.localStorage.setItem(keysStorageKey(address), JSON.stringify(bundle));
      } catch {
        // Ignore storage error
      }
    }
    return bundle;
  };

  const handleGenerateKeys = () => {
    createWorkerBundle();
  };

  const handleSwitchElysium = async () => {
    setError(null);
    setYoyoStage({
      posture: "sign",
      label: "Approve Elysium Testnet",
      sublabel: "Chain ID 99801",
    });
    try {
      await ensureElysiumNetwork((args) => switchChain.mutateAsync(args));
      setYoyoStage({
        posture: "confirm",
        label: "Connected to Elysium 99801",
        sublabel: "Ready to launch $CANON",
      });
      window.setTimeout(() => setYoyoStage(null), 1100);
    } catch (e) {
      setError(plainReason(e));
      setYoyoStage(null);
    }
  };

  const handleDownloadKeys = () => {
    if (!workerKeys) return;
    const text = [
      "CANON Testnet Background Worker Keys (Elysium Chain 99801)",
      "Keep these private keys safe and fund Relayer + Keeper with free Test HYPE.",
      "",
      `ATTESTOR_ADDRESS=${workerKeys.attestorAddress}`,
      `ATTESTOR_KEY=${workerKeys.attestorKey}`,
      "",
      `RELAYER_ADDRESS=${workerKeys.relayerAddress}`,
      `RELAYER_KEY=${workerKeys.relayerKey}`,
      "",
      `KEEPER_ADDRESS=${workerKeys.keeperAddress}`,
      `KEEPER_KEY=${workerKeys.keeperKey}`,
      "",
      `PEPPER_SALT=${workerKeys.pepperSalt}`,
      "",
    ].join("\n");
    downloadTextFile("canon-worker-keys.txt", text);
  };

  const handleFundWorker = async (label: string, to: Address) => {
    if (!onChain) return;
    setError(null);
    setBusy(`Sending 0.05 HYPE to ${label}…`);
    try {
      const wc = await getWalletClient(config, { chainId: elysium.id });
      const hash = await wc.sendTransaction({
        account: me,
        to,
        value: parseEther("0.05"),
        chain: elysium,
      });
      setLastTx(hash);
      await waitForTransactionReceipt(config, { hash, timeout: 120_000 });
      await qc.invalidateQueries();
    } catch (e) {
      setError(plainReason(e));
    } finally {
      setBusy(null);
    }
  };

  const deployContractStep = async (params: {
    stepLabel: string;
    abi: readonly unknown[];
    bytecode: Hex;
    args?: readonly unknown[];
  }): Promise<Address> => {
    setBusy(`${params.stepLabel}…`);
    setYoyoStage({
      posture: "sign",
      label: params.stepLabel,
      sublabel: "Approve in your wallet",
    });
    const pc = getPublicClient(config, { chainId: elysium.id });
    const wc = await getWalletClient(config, { chainId: elysium.id });
    if (!pc) throw new Error("No connection to Elysium Testnet RPC.");

    const data = encodeDeployData({
      abi: params.abi,
      bytecode: params.bytecode,
      args: params.args,
    });

    const est = await pc
      .estimateGas({
        account: me,
        data,
      })
      .catch(() => 2_800_000n);

    const hash = await wc.sendTransaction({
      account: me,
      data,
      gas: (est * 3n) / 2n + 150_000n,
      chain: elysium,
    });
    setLastTx(hash);
    setYoyoStage({
      posture: "scan",
      label: params.stepLabel,
      sublabel: "Confirming on Elysium 99801",
    });
    const receipt = await waitForTransactionReceipt(config, {
      hash,
      timeout: 180_000,
      retryCount: 14,
      retryDelay: 2_000,
    });
    if (!receipt.contractAddress) {
      throw new Error(`${params.stepLabel} did not return a contract address.`);
    }
    return getAddress(receipt.contractAddress);
  };

  const writeContractStep = async (params: {
    stepLabel: string;
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) => {
    setBusy(`${params.stepLabel}…`);
    setYoyoStage({
      posture: "sign",
      label: params.stepLabel,
      sublabel: "Approve in your wallet",
    });
    const pc = getPublicClient(config, { chainId: elysium.id });
    const wc = await getWalletClient(config, { chainId: elysium.id });
    if (!pc) throw new Error("No connection to Elysium Testnet RPC.");

    const est = await pc
      .estimateContractGas({
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
        account: me,
      } as Parameters<typeof pc.estimateContractGas>[0])
      .catch(() => 900_000n);

    const hash = await wc.writeContract({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      account: me,
      gas: (est * 3n) / 2n + 120_000n,
      chain: elysium,
    } as Parameters<typeof wc.writeContract>[0]);

    setLastTx(hash);
    setYoyoStage({
      posture: "scan",
      label: params.stepLabel,
      sublabel: "Confirming on Elysium 99801",
    });
    return waitForTransactionReceipt(config, {
      hash,
      timeout: 180_000,
      retryCount: 14,
      retryDelay: 2_000,
    });
  };

  const handleLaunchSuite = async () => {
    if (!onChain) return;
    setError(null);

    const cleanName = tokenName.trim() || "CANON";
    const cleanSymbol = tokenSymbol.trim().toUpperCase() || "CANON";

    // In Guided mode (or if blank), auto-create local worker keys and fill role addresses from connected wallet
    let resolvedTeam = teamInput;
    let resolvedAttestor = attestorInput;
    let resolvedCurator = curatorInput;
    let resolvedGuardian = guardianInput;

    if (mode === "guided") {
      const keys = workerKeys ?? createWorkerBundle();
      if (!isAddress(resolvedTeam)) {
        resolvedTeam = me;
        setTeamInput(me);
      }
      if (!isAddress(resolvedAttestor)) {
        resolvedAttestor = keys.attestorAddress;
        setAttestorInput(keys.attestorAddress);
      }
      if (!isAddress(resolvedCurator)) {
        resolvedCurator = me;
        setCuratorInput(me);
      }
      if (!isAddress(resolvedGuardian)) {
        resolvedGuardian = me;
        setGuardianInput(me);
      }
    }

    if (
      !isAddress(resolvedTeam) ||
      !isAddress(resolvedAttestor) ||
      !isAddress(resolvedCurator) ||
      !isAddress(resolvedGuardian)
    ) {
      setError("Enter valid 0x addresses for Team, Pass Signer, Curator, and Guardian in Setup.");
      setTab("setup");
      return;
    }

    const teamAddr = getAddress(resolvedTeam);
    const attestorAddr = getAddress(resolvedAttestor);
    const curatorAddr = getAddress(resolvedCurator);
    const guardianAddr = getAddress(resolvedGuardian);

    try {
      const pc = getPublicClient(config, { chainId: elysium.id });
      if (!pc) throw new Error("No connection to Elysium Testnet.");

      const startBlock = await pc.getBlockNumber();
      let cur: LaunchDraft = draft ?? {
        owner: me,
        tokenName: cleanName,
        tokenSymbol: cleanSymbol,
        team: teamAddr,
        teamBps,
        attestor: attestorAddr,
        curator: curatorAddr,
        guardian: guardianAddr,
        deployedBlock: startBlock.toString(),
      };

      // Step 1: Pool Engine check (use Ascend directly if open; deploy CanonTestnetAmm if Ascend paused)
      if (!cur.launchpad) {
        setBusy("Checking Ascend Launchpad status…");
        const paused = await pc
          .readContract({
            address: ASCEND_TESTNET_LAUNCHPAD,
            abi: PAUSED_ABI,
            functionName: "paused",
          })
          .catch(() => true);

        if (paused) {
          const amm = await deployContractStep({
            stepLabel: "1/6 Deploying $CANON Pool Engine",
            abi: canonTestnetAmmArtifact.abi,
            bytecode: canonTestnetAmmArtifact.bytecode,
            args: [ASCEND_TESTNET_USDC],
          });
          cur = { ...cur, launchpad: amm, usedCustomAmm: true };
        } else {
          cur = { ...cur, launchpad: ASCEND_TESTNET_LAUNCHPAD, usedCustomAmm: false };
        }
        persistDraft(cur);
      }

      // Step 2: HypePassportRegistry
      if (!cur.passportRegistry) {
        const passReg = await deployContractStep({
          stepLabel: "2/6 Deploying HYPE Pass Registry",
          abi: hypePassportRegistryArtifact.abi,
          bytecode: hypePassportRegistryArtifact.bytecode,
          args: [cur.attestor, cur.guardian],
        });
        cur = { ...cur, passportRegistry: passReg };
        persistDraft(cur);
      }

      // Step 3: CovenantFactory
      if (!cur.covenantFactory) {
        const factory = await deployContractStep({
          stepLabel: "3/6 Deploying Fee Lock Factory",
          abi: covenantFactoryArtifact.abi,
          bytecode: covenantFactoryArtifact.bytecode,
          args: [cur.launchpad!, ELYSIUM_BURN_SINK],
        });
        cur = { ...cur, covenantFactory: factory };
        persistDraft(cur);
      }

      // Step 4: CovenantFactory.launch (locks deterministic IndexVault at nonce + 3)
      if (!cur.pnth || !cur.pnthPool || !cur.pnthRouter) {
        const liveNonce = await pc.getTransactionCount({
          address: me,
          blockTag: "pending",
        });
        const predictedVault = getAddress(
          getContractAddress({
            from: me,
            nonce: BigInt(liveNonce) + 3n,
          }),
        );
        const vaultAndBurnBps = 10_000 - cur.teamBps;

        const tokenLegs =
          cur.teamBps > 0
            ? [
                { job: 1, bps: vaultAndBurnBps, target: zeroAddress },
                { job: 0, bps: cur.teamBps, target: cur.team },
              ]
            : [{ job: 1, bps: 10_000, target: zeroAddress }];

        const quoteLegs =
          cur.teamBps > 0
            ? [
                { job: 2, bps: vaultAndBurnBps, target: predictedVault },
                { job: 0, bps: cur.teamBps, target: cur.team },
              ]
            : [{ job: 2, bps: 10_000, target: predictedVault }];

        const salt = keccak256(toBytes(`canon:${me}:${Date.now()}`));
        const launchReceipt = await writeContractStep({
          stepLabel: `4/6 Minting $${cur.tokenSymbol} & Locking Fee Split`,
          address: cur.covenantFactory!,
          abi: covenantFactoryArtifact.abi,
          functionName: "launch",
          args: [
            cur.tokenName,
            cur.tokenSymbol,
            ASCEND_TESTNET_USDC,
            salt,
            tokenLegs,
            quoteLegs,
          ],
        });

        let launchedToken: Address | null = null;
        let launchedPool: Hex | null = null;
        let launchedRouter: Address | null = null;

        for (const log of launchReceipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: covenantFactoryArtifact.abi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "RouterDeployed") {
              launchedToken = getAddress(decoded.args.token);
              launchedPool = decoded.args.poolId;
              launchedRouter = getAddress(decoded.args.router);
              break;
            }
          } catch {
            // Skip unrelated log
          }
        }

        if (!launchedToken || !launchedPool || !launchedRouter) {
          throw new Error("Could not read RouterDeployed event from launch transaction.");
        }

        cur = {
          ...cur,
          launchNonce: liveNonce,
          predictedVault,
          pnth: launchedToken,
          pnthPool: launchedPool,
          pnthRouter: launchedRouter,
        };
        persistDraft(cur);
      }

      // Step 5: ConstituentRegistry & PantheonStaking
      if (!cur.constituentRegistry) {
        if (typeof cur.launchNonce === "number") {
          const n = await pc.getTransactionCount({ address: me, blockTag: "pending" });
          if (n !== cur.launchNonce + 1) {
            throw new Error(
              "Wallet nonce moved since Step 4, which would shift the predicted IndexVault address. Tap Reset Draft to start a clean launch.",
            );
          }
        }
        const reg = await deployContractStep({
          stepLabel: "5/6 Deploying Clean Basket Registry",
          abi: constituentRegistryArtifact.abi,
          bytecode: constituentRegistryArtifact.bytecode,
          args: [
            ASCEND_TESTNET_LAUNCHPAD,
            ASCEND_TESTNET_USDC,
            cur.pnth!,
            cur.curator,
            cur.guardian,
            100_000_000n,
          ],
        });
        cur = { ...cur, constituentRegistry: reg };
        persistDraft(cur);
      }

      if (!cur.staking) {
        if (typeof cur.launchNonce === "number") {
          const n = await pc.getTransactionCount({ address: me, blockTag: "pending" });
          if (n !== cur.launchNonce + 2) {
            throw new Error(
              "Wallet nonce moved before Staking deploy, which would shift the predicted IndexVault address. Tap Reset Draft to start a clean launch.",
            );
          }
        }
        const stk = await deployContractStep({
          stepLabel: "5/6 Deploying Staking Rewards",
          abi: pantheonStakingArtifact.abi,
          bytecode: pantheonStakingArtifact.bytecode,
          args: [cur.pnth!, cur.passportRegistry!, cur.constituentRegistry!],
        });
        cur = { ...cur, staking: stk };
        persistDraft(cur);
      }

      // Step 6: IndexVault (lands on exact predictedVault address)
      if (!cur.indexVault) {
        if (typeof cur.launchNonce === "number") {
          const n = await pc.getTransactionCount({ address: me, blockTag: "pending" });
          if (n !== cur.launchNonce + 3) {
            throw new Error(
              "Wallet nonce moved before IndexVault deploy. Tap Reset Draft to start a clean launch.",
            );
          }
        }
        const vlt = await deployContractStep({
          stepLabel: "6/6 Deploying Index Vault",
          abi: indexVaultArtifact.abi,
          bytecode: indexVaultArtifact.bytecode,
          args: [
            ASCEND_TESTNET_LAUNCHPAD,
            cur.constituentRegistry!,
            cur.staking!,
            BigInt(365 * 86_400),
          ],
        });
        cur = { ...cur, indexVault: vlt };
        persistDraft(cur);
      }

      // Automatically activate the newly deployed $CANON suite across the app
      const fullDeployment: Deployment = {
        chainId: 99801,
        launchpad: cur.launchpad!,
        ascendLaunchpad: ASCEND_TESTNET_LAUNCHPAD,
        usdc: ASCEND_TESTNET_USDC,
        burnSink: ELYSIUM_BURN_SINK,
        passportRegistry: cur.passportRegistry!,
        covenantFactory: cur.covenantFactory!,
        pnth: cur.pnth!,
        pnthPool: cur.pnthPool!,
        pnthRouter: cur.pnthRouter!,
        constituentRegistry: cur.constituentRegistry!,
        staking: cur.staking!,
        indexVault: cur.indexVault!,
        swapper: cur.swapper,
        drip: cur.drip,
        team: cur.team,
        teamBps: cur.teamBps,
        tokenName: cur.tokenName,
        tokenSymbol: cur.tokenSymbol,
        customActive: true,
        deployedBlock: cur.deployedBlock,
      };
      await activateCustomDeployment(fullDeployment);
      await qc.invalidateQueries();
      setYoyoStage({
        posture: "confirm",
        label: `$${cur.tokenSymbol} Suite Live on Elysium`,
        sublabel: "Next: Seed pool & backer faucet",
      });
      window.setTimeout(() => setYoyoStage(null), 1800);
      setTab("seed");
    } catch (e) {
      setError(plainReason(e));
      setYoyoStage({
        posture: "alert",
        label: "Step paused — progress saved",
        sublabel: "Tap Resume to continue",
      });
      window.setTimeout(() => setYoyoStage(null), 2000);
    } finally {
      setBusy(null);
    }
  };

  const handleSeedPoolAndDrip = async () => {
    if (!onChain || !targetDeployment) return;
    setError(null);
    try {
      const pc = getPublicClient(config, { chainId: elysium.id });
      if (!pc) throw new Error("No connection to Elysium Testnet.");

      let swapperAddr = (draft?.swapper ?? targetDeployment.swapper) as Address | undefined;
      const customPool =
        targetDeployment.launchpad.toLowerCase() !== ASCEND_TESTNET_LAUNCHPAD.toLowerCase();

      // Always deploy CanonSwapper for custom launches if not deployed in draft yet
      if (!draft?.swapper) {
        swapperAddr = await deployContractStep({
          stepLabel: "1/5 Deploying Pool Swapper",
          abi: canonSwapperArtifact.abi,
          bytecode: canonSwapperArtifact.bytecode,
          args: [ASCEND_VAULT, ASCEND_PM],
        });
        if (draft) {
          persistDraft({ ...draft, swapper: swapperAddr });
        }
      }

      if (!swapperAddr) throw new Error("Swapper address missing.");

      const seedUsdc = 500_000_000n; // 500 USDC
      await writeContractStep({
        stepLabel: "2/5 Minting 500 Test USDC",
        address: targetDeployment.usdc,
        abi: MINT_USDC_ABI,
        functionName: "mint",
        args: [me, seedUsdc],
      });

      await writeContractStep({
        stepLabel: "3/5 Approving Test USDC",
        address: targetDeployment.usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [swapperAddr, seedUsdc],
      });

      const poolManager = customPool ? targetDeployment.launchpad : ASCEND_PM;
      const poolKey = buildPoolKey(
        targetDeployment.pnth,
        targetDeployment.usdc,
        targetDeployment.launchpad,
        poolManager,
      );
      const zeroForOne = BigInt(targetDeployment.usdc) < BigInt(targetDeployment.pnth);

      await writeContractStep({
        stepLabel: "4/5 Buying Initial $CANON",
        address: swapperAddr,
        abi: canonSwapperArtifact.abi,
        functionName: "swapExactIn",
        args: [poolKey, zeroForOne, seedUsdc],
      });

      let dripAddr = draft?.drip ?? targetDeployment.drip;
      if (!draft?.drip) {
        dripAddr = await deployContractStep({
          stepLabel: "5/5 Deploying Free $CANON Drip",
          abi: testDripArtifact.abi,
          bytecode: testDripArtifact.bytecode,
          args: [targetDeployment.pnth, 250n * 10n ** 18n],
        });

        const bal = await pc.readContract({
          address: targetDeployment.pnth,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [me],
        });

        if (bal > 1_000n * 10n ** 18n) {
          await writeContractStep({
            stepLabel: "5/5 Funding Free $CANON Drip",
            address: targetDeployment.pnth,
            abi: erc20Abi,
            functionName: "transfer",
            args: [dripAddr, bal / 2n],
          });
        }
      }

      const nextDraft = draft
        ? { ...draft, swapper: swapperAddr, drip: dripAddr, seededPool: true }
        : null;
      if (nextDraft) persistDraft(nextDraft);

      const updated: Deployment = {
        ...targetDeployment,
        swapper: swapperAddr,
        drip: dripAddr,
        customActive: true,
      };
      await activateCustomDeployment(updated);
      await qc.invalidateQueries();
      setYoyoStage({
        posture: "confirm",
        label: "Pool & 250 Drip Ready",
        sublabel: "Live on Elysium 99801",
      });
      window.setTimeout(() => setYoyoStage(null), 1600);
    } catch (e) {
      setError(plainReason(e));
      setYoyoStage(null);
    } finally {
      setBusy(null);
    }
  };

  /**
   * One-tap Guided Step 3: Deploys Swapper, seeds 500 Test USDC into $CANON pool,
   * stocks the 250 $CANON backer drip faucet, queues the 10-coin clean basket,
   * and triggers the initial fee route so Vault USDC shows live on-chain.
   */
  const handleGuidedSeedAll = async () => {
    if (!onChain || !targetDeployment) return;
    setError(null);
    try {
      const pc = getPublicClient(config, { chainId: elysium.id });
      if (!pc) throw new Error("No connection to Elysium Testnet.");

      let curDraft = draft;
      let swapperAddr = (curDraft?.swapper ?? targetDeployment.swapper) as Address | undefined;
      const customPool =
        targetDeployment.launchpad.toLowerCase() !== ASCEND_TESTNET_LAUNCHPAD.toLowerCase();

      if (!curDraft?.swapper && !swapperAddr) {
        swapperAddr = await deployContractStep({
          stepLabel: "1/6 Deploying Pool Swapper",
          abi: canonSwapperArtifact.abi,
          bytecode: canonSwapperArtifact.bytecode,
          args: [ASCEND_VAULT, ASCEND_PM],
        });
        if (curDraft) {
          curDraft = { ...curDraft, swapper: swapperAddr };
          persistDraft(curDraft);
        }
      }

      if (!swapperAddr) throw new Error("Swapper address missing.");

      if (!curDraft?.seededPool) {
        const seedUsdc = 500_000_000n;
        await writeContractStep({
          stepLabel: "2/6 Minting 500 Test USDC",
          address: targetDeployment.usdc,
          abi: MINT_USDC_ABI,
          functionName: "mint",
          args: [me, seedUsdc],
        });

        await writeContractStep({
          stepLabel: "3/6 Approving Test USDC",
          address: targetDeployment.usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [swapperAddr, seedUsdc],
        });

        const poolManager = customPool ? targetDeployment.launchpad : ASCEND_PM;
        const poolKey = buildPoolKey(
          targetDeployment.pnth,
          targetDeployment.usdc,
          targetDeployment.launchpad,
          poolManager,
        );
        const zeroForOne = BigInt(targetDeployment.usdc) < BigInt(targetDeployment.pnth);

        await writeContractStep({
          stepLabel: `4/6 Seeding $${targetDeployment.tokenSymbol ?? "CANON"} Pool`,
          address: swapperAddr,
          abi: canonSwapperArtifact.abi,
          functionName: "swapExactIn",
          args: [poolKey, zeroForOne, seedUsdc],
        });

        if (curDraft) {
          curDraft = { ...curDraft, seededPool: true };
          persistDraft(curDraft);
        }
      }

      let dripAddr = curDraft?.drip ?? targetDeployment.drip;
      if (!dripAddr) {
        dripAddr = await deployContractStep({
          stepLabel: "5/6 Deploying 250 Backer Drip",
          abi: testDripArtifact.abi,
          bytecode: testDripArtifact.bytecode,
          args: [targetDeployment.pnth, 250n * 10n ** 18n],
        });

        const bal = await pc.readContract({
          address: targetDeployment.pnth,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [me],
        });

        if (bal > 1_000n * 10n ** 18n) {
          await writeContractStep({
            stepLabel: "5/6 Stocking 250 Backer Drip",
            address: targetDeployment.pnth,
            abi: erc20Abi,
            functionName: "transfer",
            args: [dripAddr, bal / 2n],
          });
        }

        if (curDraft) {
          curDraft = { ...curDraft, drip: dripAddr };
          persistDraft(curDraft);
        }
      }

      if (proposalCount === 0 && !curDraft?.proposedBasket) {
        await writeContractStep({
          stepLabel: "6/6 Queuing 10-Coin Clean Basket",
          address: targetDeployment.constituentRegistry,
          abi: constituentRegistryAbi,
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
        if (curDraft) {
          curDraft = { ...curDraft, proposedBasket: true };
          persistDraft(curDraft);
        }
      }

      if (routerRuns === 0) {
        await writeContractStep({
          stepLabel: "Routing First Trade Fees to Vault",
          address: targetDeployment.pnthRouter,
          abi: covenantRouterAbi,
          functionName: "run",
        }).catch(() => null);
      }

      const updated: Deployment = {
        ...targetDeployment,
        swapper: swapperAddr,
        drip: dripAddr,
        customActive: true,
      };
      await activateCustomDeployment(updated);
      await qc.invalidateQueries();
      setYoyoStage({
        posture: "confirm",
        label: "Ready for Backers & Grants",
        sublabel: "Share your live link below",
      });
      window.setTimeout(() => setYoyoStage(null), 2000);
    } catch (e) {
      setError(plainReason(e));
      setYoyoStage(null);
    } finally {
      setBusy(null);
    }
  };

  const handleProposeBasket = async () => {
    if (!onChain || !targetDeployment) return;
    setError(null);
    try {
      await writeContractStep({
        stepLabel: "Proposing 10-Coin Clean Basket",
        address: targetDeployment.constituentRegistry,
        abi: constituentRegistryAbi,
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
      if (draft) persistDraft({ ...draft, proposedBasket: true });
      await qc.invalidateQueries();
    } catch (e) {
      setError(plainReason(e));
    } finally {
      setBusy(null);
    }
  };

  const handleExecuteBasket = async () => {
    if (!onChain || !targetDeployment || proposalCount === 0) return;
    setError(null);
    try {
      await writeContractStep({
        stepLabel: `Activating Basket Proposal #${proposalCount}`,
        address: targetDeployment.constituentRegistry,
        abi: constituentRegistryAbi,
        functionName: "execute",
        args: [BigInt(proposalCount)],
      });
      await qc.invalidateQueries();
    } catch (e) {
      setError(plainReason(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRunKeeperNow = async () => {
    if (!onChain || !targetDeployment) return;
    setError(null);
    try {
      await writeContractStep({
        stepLabel: "Routing Locked Swap Fees",
        address: targetDeployment.pnthRouter,
        abi: covenantRouterAbi,
        functionName: "run",
      });
      if (activeBasketId > 0) {
        await writeContractStep({
          stepLabel: "Buying Top 10 Basket Coins",
          address: targetDeployment.indexVault,
          abi: indexVaultAbi,
          functionName: "rebalance",
          args: [5n],
        });
      }
      await qc.invalidateQueries();
    } catch (e) {
      setError(plainReason(e));
    } finally {
      setBusy(null);
    }
  };

  const handleActivateDraft = async () => {
    if (!targetDeployment) return;
    setBusy("Switching app to your $CANON…");
    try {
      await activateCustomDeployment(targetDeployment);
      await qc.invalidateQueries();
    } finally {
      setBusy(null);
    }
  };

  const handleResetToShared = async () => {
    setBusy("Restoring shared testnet preview…");
    try {
      await resetToSharedDeployment();
      await qc.invalidateQueries();
    } finally {
      setBusy(null);
    }
  };

  const passportWorkerSnippet = useMemo(() => {
    const reg = targetDeployment?.passportRegistry ?? "0xYOUR_PASSPORT_REGISTRY";
    return [
      "cd workers/passport-worker",
      "npm install",
      "npx wrangler kv namespace create PASS_KV",
      `# Set PASSPORT_REGISTRY = "${reg}" in wrangler.toml`,
      "npx wrangler secret put ATTESTOR_KEY",
      "npx wrangler secret put RELAYER_KEY",
      "npx wrangler secret put PEPPER_SALT",
      "npx wrangler deploy",
    ].join("\n");
  }, [targetDeployment]);

  const keeperWorkerSnippet = useMemo(() => {
    const d = targetDeployment;
    return [
      "cd workers/keeper-worker",
      "npm install",
      "npx wrangler kv namespace create KEEPER_KV",
      `# Update wrangler.toml [vars] with your live contracts:`,
      `# PNTH_ROUTER = "${d?.pnthRouter ?? "0x..."}"`,
      `# INDEX_VAULT = "${d?.indexVault ?? "0x..."}"`,
      `# STAKING = "${d?.staking ?? "0x..."}"`,
      `# CONSTITUENT_REGISTRY = "${d?.constituentRegistry ?? "0x..."}"`,
      "npx wrangler secret put KEEPER_KEY",
      "npx wrangler deploy",
    ].join("\n");
  }, [targetDeployment]);

  const deployedCount = [
    draft?.launchpad,
    draft?.passportRegistry,
    draft?.covenantFactory,
    draft?.pnth,
    draft?.constituentRegistry,
    draft?.indexVault,
  ].filter(Boolean).length;

  const launchComplete = Boolean(
    draft?.launchpad &&
      draft.passportRegistry &&
      draft.covenantFactory &&
      draft.pnth &&
      draft.pnthRouter &&
      draft.constituentRegistry &&
      draft.staking &&
      draft.indexVault,
  );

  const guidedSeedReady = Boolean(
    (draft?.seededPool && draft?.drip) ||
      (customLive && targetDeployment?.swapper && targetDeployment?.drip),
  );

  const effectiveTeamBps = targetDeployment?.teamBps ?? teamBps;
  const vaultSharePct = ((10_000 - teamBps) / 100).toFixed(0);
  const teamSharePct = (teamBps / 100).toFixed(0);

  const backerShareUrl = useMemo(() => {
    if (!targetDeployment) return "";
    return buildBackerShareUrl(targetDeployment, "/trade");
  }, [targetDeployment]);

  const grantProofText = useMemo(() => {
    if (!targetDeployment) return "";
    const sym = targetDeployment.tokenSymbol || "CANON";
    const tBps = typeof targetDeployment.teamBps === "number" ? targetDeployment.teamBps : 1500;
    const vPct = ((10_000 - tBps) / 100).toFixed(0);
    const tPct = (tBps / 100).toFixed(0);
    const lines = [
      `$${sym} (${targetDeployment.tokenName || "CANON"}) — Liquid 10-Coin Clean Index`,
      `Network: Elysium Testnet (Chain ID 99801)`,
      ``,
      `What $${sym} Solves:`,
      `- One liquid index holding Ascend's top 10 clean coins screened on-chain by Lens.`,
      `- Two-way flywheel: buys route USDC trade fees straight to The Vault for stakers; sells burn $${sym} forever at a dead sink.`,
      `- Hard-coded ${vPct}% Vault & Burn / ${tPct}% Team fee split with 0 admin or pause keys.`,
      `- Sybil-free community basket seats powered by HYPE Pass (1 real Hyperliquid user = 1 vote).`,
      ``,
      `Live Backer & Reviewer Link (1-tap 250 $${sym} test faucet):`,
      backerShareUrl,
      ``,
      `Verified Elysium 99801 Contracts:`,
      `- $${sym} Token: ${targetDeployment.pnth} (${explorer("token", targetDeployment.pnth)})`,
      `- Fee Lock Router: ${targetDeployment.pnthRouter} (${explorer("address", targetDeployment.pnthRouter)})`,
      `- Index Vault: ${targetDeployment.indexVault} (${explorer("address", targetDeployment.indexVault)})`,
      `- Staking Rewards: ${targetDeployment.staking} (${explorer("address", targetDeployment.staking)})`,
      `- Basket Registry: ${targetDeployment.constituentRegistry} (${explorer("address", targetDeployment.constituentRegistry)})`,
      `- HYPE Pass Registry: ${targetDeployment.passportRegistry} (${explorer("address", targetDeployment.passportRegistry)})`,
    ];
    if (targetDeployment.drip) {
      lines.push(
        `- 250 $${sym} Backer Drip: ${targetDeployment.drip} (${explorer("address", targetDeployment.drip)})`,
      );
    }
    return lines.join("\n");
  }, [targetDeployment, backerShareUrl]);

  const hasCustomSuite = launchComplete || customLive;
  const zeroGas = onChain && hypeBal.data && hypeBal.data.value === 0n;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Launch $CANON"
      subtitle={
        customLive && deployment
          ? `Live $${deployment.tokenSymbol ?? "CANON"} (${short(deployment.pnth)}) · Elysium 99801`
          : "Deploy from your phone wallet & share with backers on Elysium 99801"
      }
      maxWidthClass="lg:max-w-2xl"
    >
      <div className="space-y-5">
        <SegmentedControl
          options={STUDIO_MODES}
          value={mode}
          onChange={setMode}
          ariaLabel="Launch mode"
        />

        <div className="flex flex-col gap-3 rounded-[18px] bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[14.5px] font-extrabold tracking-[-0.015em] text-ink">
              Free Testnet Keys &amp; $0 Cost Guide
            </p>
            <p className="mt-0.5 text-[12.5px] text-stone">
              PDF · Every API key, free quota &amp; setup step · <span className="num font-bold text-ink">$0.00/mo</span>
            </p>
          </div>
          <a
            href="/canon-testnet-keys.pdf"
            download="canon-testnet-keys-guide.pdf"
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[12px] bg-primary-bg px-4 py-2 text-[13px] font-extrabold tracking-[-0.01em] text-primary-fg transition-transform active:scale-[0.98] hover:opacity-90"
          >
            <Download className="h-4 w-4 shrink-0" />
            <span>Download PDF</span>
          </a>
        </div>

        {yoyoStage && (
          <YoyoVerifyStage
            posture={yoyoStage.posture}
            address={onChain ? me : undefined}
            label={yoyoStage.label}
            sublabel={yoyoStage.sublabel}
          />
        )}

        {/* =================================================================
            GUIDED PHONE-WALLET LAUNCH (Default 3-Step Flow for Founders & Backers)
           ================================================================= */}
        {mode === "guided" && (
          <div className="space-y-4">
            {/* STEP 01: WALLET & FREE GAS */}
            <div className="rounded-[20px] bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="ui-label">01. Wallet & Free Gas</p>
                  <p className="mt-1 text-[17px] font-extrabold tracking-tight text-ink">
                    {!isConnected
                      ? "Connect your wallet"
                      : !onChain
                        ? "Switch to Elysium Testnet"
                        : zeroGas
                          ? "Claim free HYPE gas to deploy"
                          : `Ready · ${fmt(hypeBal.data?.value)} HYPE`}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-stone">
                    {!isConnected
                      ? "Pair any phone wallet via QR/app link or browser wallet."
                      : !onChain
                        ? "Adds Elysium Testnet (Chain 99801) to your wallet in one tap."
                        : "Deploying the full $CANON suite uses ~0.02 free test HYPE."}
                  </p>
                </div>
                {onChain && !zeroGas && (
                  <span className="num shrink-0 text-[12.5px] font-extrabold text-forest">
                    Ready ✓
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                {!isConnected ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenWallet();
                    }}
                    className="btn-signal w-full"
                  >
                    Connect Wallet
                  </button>
                ) : !onChain ? (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={handleSwitchElysium}
                    className="btn-signal w-full"
                  >
                    Switch to Elysium 99801
                  </button>
                ) : (
                  <a
                    href={FAUCET_URL}
                    target="_blank"
                    rel="noreferrer"
                    className={`${zeroGas ? "btn-signal" : "btn-secondary"} w-full`}
                  >
                    Claim Free Test HYPE
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>

            {/* STEP 02: DEPLOY $CANON SUITE */}
            <div className="space-y-4 rounded-[20px] bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="ui-label">02. Deploy $CANON Contract Suite</p>
                  <p className="mt-1 text-[17px] font-extrabold tracking-tight text-ink">
                    {launchComplete
                      ? `$${draft?.tokenSymbol ?? tokenSymbol} Deployed on Elysium`
                      : customLive && deployment
                        ? `Live $${deployment.tokenSymbol ?? "CANON"} Active`
                        : `${vaultSharePct}% Vault & Burn · ${teamSharePct}% Team`}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-stone">
                    Worker keys and role wallets auto-configure from your connected address. Progress saves after every block.
                  </p>
                </div>
                <span className="num shrink-0 text-[12.5px] font-extrabold text-stone">
                  {launchComplete ? "6/6 ✓" : `${deployedCount}/6`}
                </span>
              </div>

              {!launchComplete && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="guided-token-name" className="ui-label">
                        Token Name
                      </label>
                      <input
                        id="guided-token-name"
                        value={tokenName}
                        onChange={(e) => setTokenName(e.target.value)}
                        className="canon-input mt-1.5 min-h-[48px] w-full px-3.5 text-[14.5px] font-bold"
                      />
                    </div>
                    <div>
                      <label htmlFor="guided-token-symbol" className="ui-label">
                        Ticker
                      </label>
                      <input
                        id="guided-token-symbol"
                        value={tokenSymbol}
                        onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                        className="canon-input num mt-1.5 min-h-[48px] w-full px-3.5 text-[14.5px] font-bold"
                      />
                    </div>
                  </div>

                  <div>
                    <p className="ui-label">Creator Team Share (Locked at Launch)</p>
                    <div className="mt-1.5 grid grid-cols-4 gap-2">
                      {TEAM_CUT_PRESETS.map((p) => {
                        const active = teamBps === p.bps;
                        return (
                          <button
                            key={p.bps}
                            type="button"
                            onClick={() => setTeamBps(p.bps)}
                            className={`num min-h-[46px] cursor-pointer rounded-[12px] text-[14px] font-bold transition-colors ${
                              active
                                ? "bg-signal text-signal-ink"
                                : "bg-well text-ink hover:bg-well-hover"
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                {!launchComplete ? (
                  <button
                    type="button"
                    disabled={!onChain || !!busy}
                    onClick={handleLaunchSuite}
                    className="btn-signal w-full"
                  >
                    {busy && !busy.includes("/6 Seeding") && !busy.includes("Backer Drip")
                      ? busy
                      : draft?.launchpad
                        ? `Resume $${tokenSymbol || "CANON"} Launch (${deployedCount}/6)`
                        : `Deploy $${tokenSymbol || "CANON"} Suite`}
                  </button>
                ) : (
                  <div className="flex w-full items-center justify-between gap-3 rounded-[14px] bg-well px-3.5 py-2.5 text-[13px]">
                    <span className="num font-bold text-forest">
                      Token {short(draft?.pnth ?? "")} · Locked {((10_000 - effectiveTeamBps) / 100).toFixed(0)}/{(effectiveTeamBps / 100).toFixed(0)}
                    </span>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => {
                        persistDraft(null);
                        setError(null);
                      }}
                      className="cursor-pointer font-bold text-stone hover:text-ink"
                    >
                      New Draft
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* STEP 03: SEED BACKER FAUCET & SHARE FOR CROWDFUNDERS / GRANTS */}
            <div className="space-y-4 rounded-[20px] bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="ui-label">03. Seed Backer Faucet & Share</p>
                  <p className="mt-1 text-[17px] font-extrabold tracking-tight text-ink">
                    {guidedSeedReady
                      ? "Live & Testable by Crowdfunders and Grants"
                      : "Seed Pool, 250 Drip & 10-Coin Basket"}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-stone">
                    Mints 500 free Test USDC to open trading, stocks a one-tap 250 ${targetDeployment?.tokenSymbol ?? (tokenSymbol || "CANON")} faucet for reviewers, and queues the 10-coin basket.
                  </p>
                </div>
                {guidedSeedReady && (
                  <span className="num shrink-0 text-[12.5px] font-extrabold text-forest">
                    Seeded ✓
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={!onChain || !hasCustomSuite || !!busy}
                onClick={handleGuidedSeedAll}
                className={guidedSeedReady ? "btn-secondary w-full" : "btn-primary w-full"}
              >
                {busy && (busy.includes("/6") || busy.includes("First Trade Fees"))
                  ? busy
                  : !hasCustomSuite
                    ? "Complete Step 02 First"
                    : guidedSeedReady
                      ? "Top Up Pool & Route Fees Again"
                      : "Seed Pool, 250 Drip & 10-Coin Basket"}
              </button>

              {hasCustomSuite && targetDeployment && (
                <div className="space-y-3 pt-4">
                  <p className="ui-label">Share With Crowdfunders & Grant Committees</p>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => copyText("share-link", backerShareUrl)}
                      className="btn-signal w-full text-[13.5px]"
                    >
                      {copiedId === "share-link" ? (
                        <>
                          <CheckIcon className="h-4 w-4" />
                          Live Link Copied
                        </>
                      ) : (
                        <>
                          <Link2 className="h-4 w-4" />
                          Copy Live Backer Link
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => copyText("grant-proof", grantProofText)}
                      className="btn-secondary w-full text-[13.5px]"
                    >
                      {copiedId === "grant-proof" ? (
                        <>
                          <CheckIcon className="h-4 w-4 text-forest" />
                          Grant Proof Copied
                        </>
                      ) : (
                        <>
                          <FileText className="h-4 w-4" />
                          Copy Grant Contract Proof
                        </>
                      )}
                    </button>
                  </div>

                  {onOpenTrade && (
                    <button
                      type="button"
                      onClick={onOpenTrade}
                      className="btn-secondary w-full text-[13.5px]"
                    >
                      Open Trade & Test Live ${targetDeployment.tokenSymbol ?? "CANON"}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  )}

                  {/* Clean unboxed contract explorer proof row */}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1 text-[12.5px] font-semibold text-stone">
                    <a
                      href={explorer("token", targetDeployment.pnth)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-ink"
                    >
                      Token ↗
                    </a>
                    <span aria-hidden="true">·</span>
                    <a
                      href={explorer("address", targetDeployment.pnthRouter)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-ink"
                    >
                      Fee Router ↗
                    </a>
                    <span aria-hidden="true">·</span>
                    <a
                      href={explorer("address", targetDeployment.indexVault)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-ink"
                    >
                      Vault ↗
                    </a>
                    <span aria-hidden="true">·</span>
                    <a
                      href={explorer("address", targetDeployment.staking)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-ink"
                    >
                      Staking ↗
                    </a>
                    {targetDeployment.drip && (
                      <>
                        <span aria-hidden="true">·</span>
                        <a
                          href={explorer("address", targetDeployment.drip)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-ink"
                        >
                          250 Drip ↗
                        </a>
                      </>
                    )}
                  </div>
                </div>
              )}

              <TxFeedback error={error} lastTx={lastTx} />
            </div>
          </div>
        )}

        {/* =================================================================
            FULL CONTROLS (4-Tab Studio for Custom Roles & Cloudflare Workers)
           ================================================================= */}
        {mode === "full" && (
          <>
            <SegmentedControl
              options={STUDIO_TABS}
              value={tab}
              onChange={setTab}
              ariaLabel="Testnet Studio stages"
            />

            {/* Wallet / Chain Gate Banner when disconnected or wrong network */}
            {!isConnected ? (
              <div className="flex flex-col gap-3 rounded-[18px] bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[14.5px] font-bold text-ink">
                    Connect wallet to deploy or sign
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-stone">
                    Works with mobile QR wallets and browser extensions on Elysium Testnet.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenWallet();
                  }}
                  className="btn-primary shrink-0 px-5"
                >
                  Connect Wallet
                </button>
              </div>
            ) : !onChain ? (
              <div className="flex flex-col gap-3 rounded-[18px] bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[14.5px] font-bold text-ink">
                    Switch wallet to Elysium Testnet
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-stone">
                    Chain ID 99801 · Free test HYPE gas
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSwitchElysium}
                  className="btn-signal shrink-0 px-5"
                >
                  Switch Network
                </button>
              </div>
            ) : null}

        {/* =================================================================
            STAGE 1: SETUP (Gas, Offline Worker Keys, 15% Fee Split & Roles)
           ================================================================= */}
        {tab === "setup" && (
          <div className="space-y-5">
            {/* Gas & Faucet Check */}
            <div className="rounded-[20px] bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="ui-label">01. Gas & Network</p>
                  <p className="mt-1 text-[16px] font-extrabold tracking-tight text-ink">
                    Elysium Testnet · 99801
                  </p>
                </div>
                <div className="text-right">
                  <p className="ui-label">Your Gas</p>
                  <p className="num mt-1 text-[16px] font-bold text-ink">
                    {onChain ? `${fmt(hypeBal.data?.value)} HYPE` : "—"}
                  </p>
                </div>
              </div>
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 pt-3.5 text-[13px] text-stone">
                <span>Full 6-contract deploy uses ~0.02 Test HYPE.</span>
                <a
                  href={FAUCET_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[38px] items-center gap-1 font-bold text-signal hover:underline"
                >
                  Claim Free HYPE
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            {/* In-Browser Worker Key Generator */}
            <div className="rounded-[20px] bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="ui-label">02. Background Worker Keys</p>
                  <p className="mt-1 text-[16px] font-extrabold tracking-tight text-ink">
                    HYPE Pass Signer · Relayer · Keeper
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-stone">
                    Generated locally in your browser. Never sent to this server.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateKeys}
                  className="btn-secondary min-h-[44px] px-4 text-[13.5px]"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {workerKeys ? "New Keys" : "Create Keys"}
                </button>
              </div>

              {workerKeys && (
                <div className="mt-4 space-y-3 pt-4">
                  <div className="space-y-1 text-[13px]">
                    <div className="flex items-center justify-between gap-2 py-2.5">
                      <div>
                        <span className="font-bold text-ink">Pass Signer</span>
                        <span className="ml-2 text-stone">Signs HYPE tier proofs</span>
                      </div>
                      <CodeScramble
                        value={short(workerKeys.attestorAddress)}
                        className="num font-bold text-ink"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div>
                        <span className="font-bold text-ink">Pass Relayer</span>
                        <span className="num ml-2 text-stone">
                          {short(workerKeys.relayerAddress)} · {fmt(relayerBal.data?.value)} HYPE
                        </span>
                      </div>
                      {onChain && (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => handleFundWorker("Pass Relayer", workerKeys.relayerAddress)}
                          className="min-h-[38px] cursor-pointer text-[12.5px] font-bold text-signal hover:underline disabled:opacity-40"
                        >
                          Send 0.05 HYPE →
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div>
                        <span className="font-bold text-ink">Vault Keeper</span>
                        <span className="num ml-2 text-stone">
                          {short(workerKeys.keeperAddress)} · {fmt(keeperBal.data?.value)} HYPE
                        </span>
                      </div>
                      {onChain && (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => handleFundWorker("Vault Keeper", workerKeys.keeperAddress)}
                          className="min-h-[38px] cursor-pointer text-[12.5px] font-bold text-signal hover:underline disabled:opacity-40"
                        >
                          Send 0.05 HYPE →
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          "all-keys",
                          `ATTESTOR_KEY=${workerKeys.attestorKey}\nRELAYER_KEY=${workerKeys.relayerKey}\nKEEPER_KEY=${workerKeys.keeperKey}\nPEPPER_SALT=${workerKeys.pepperSalt}`,
                        )
                      }
                      className="btn-secondary w-full text-[13.5px]"
                    >
                      {copiedId === "all-keys" ? (
                        <>
                          <CheckIcon className="h-4 w-4 text-forest" />
                          Copied Private Secrets
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy Worker Secrets
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadKeys}
                      className="btn-secondary w-full text-[13.5px]"
                    >
                      <Download className="h-4 w-4" />
                      Save Keys (.txt)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Token Identity, Permanent 15% Fee Lock & Role Addresses */}
            <div className="space-y-4 rounded-[20px] bg-surface p-5">
              <div>
                <p className="ui-label">03. Token & Permanent Fee Split</p>
                <p className="mt-1 text-[16px] font-extrabold tracking-tight text-ink">
                  {vaultSharePct}% Vault & Burn · {teamSharePct}% Team
                </p>
                <p className="mt-1 text-[13px] text-stone">
                  Locked on-chain at launch with zero admin edit key. Buy fees fund The Vault in USDC; sell fees burn ${tokenSymbol || "CANON"}.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="studio-token-name" className="ui-label">
                    Token Name
                  </label>
                  <input
                    id="studio-token-name"
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    className="canon-input mt-1.5 min-h-[48px] w-full px-3.5 text-[14.5px] font-bold"
                  />
                </div>
                <div>
                  <label htmlFor="studio-token-symbol" className="ui-label">
                    Ticker
                  </label>
                  <input
                    id="studio-token-symbol"
                    value={tokenSymbol}
                    onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                    className="canon-input num mt-1.5 min-h-[48px] w-full px-3.5 text-[14.5px] font-bold"
                  />
                </div>
              </div>

              <div>
                <p className="ui-label">Creator Team Cut</p>
                <div className="mt-1.5 grid grid-cols-4 gap-2">
                  {TEAM_CUT_PRESETS.map((p) => {
                    const active = teamBps === p.bps;
                    return (
                      <button
                        key={p.bps}
                        type="button"
                        onClick={() => setTeamBps(p.bps)}
                        className={`num min-h-[46px] cursor-pointer rounded-[12px] text-[14px] font-bold transition-colors ${
                          active
                            ? "bg-signal text-signal-ink"
                            : "bg-well text-ink hover:bg-well-hover"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 pt-3.5">
                <div>
                  <label htmlFor="studio-team-addr" className="ui-label">
                    Team Fee Wallet ({teamSharePct}%)
                  </label>
                  <input
                    id="studio-team-addr"
                    value={teamInput}
                    onChange={(e) => setTeamInput(e.target.value.trim())}
                    placeholder="0x…"
                    spellCheck={false}
                    className="canon-input num mt-1 min-h-[48px] w-full px-3.5 text-[13.5px] font-semibold"
                  />
                </div>

                <div>
                  <label htmlFor="studio-attestor-addr" className="ui-label">
                    Pass Signer Wallet (HYPE Pass Attestor)
                  </label>
                  <input
                    id="studio-attestor-addr"
                    value={attestorInput}
                    onChange={(e) => setAttestorInput(e.target.value.trim())}
                    placeholder="0x…"
                    spellCheck={false}
                    className="canon-input num mt-1 min-h-[48px] w-full px-3.5 text-[13.5px] font-semibold"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="studio-curator-addr" className="ui-label">
                      Basket Curator
                    </label>
                    <input
                      id="studio-curator-addr"
                      value={curatorInput}
                      onChange={(e) => setCuratorInput(e.target.value.trim())}
                      placeholder="0x…"
                      spellCheck={false}
                      className="canon-input num mt-1 min-h-[48px] w-full px-3.5 text-[13px] font-semibold"
                    />
                  </div>
                  <div>
                    <label htmlFor="studio-guardian-addr" className="ui-label">
                      Veto Guardian
                    </label>
                    <input
                      id="studio-guardian-addr"
                      value={guardianInput}
                      onChange={(e) => setGuardianInput(e.target.value.trim())}
                      placeholder="0x…"
                      spellCheck={false}
                      className="canon-input num mt-1 min-h-[48px] w-full px-3.5 text-[13px] font-semibold"
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setTab("launch")}
                className="btn-primary w-full"
              >
                Continue to Launch →
              </button>
            </div>
          </div>
        )}

        {/* =================================================================
            STAGE 2: LAUNCH (Deterministic 6-Step Contract Suite Deployer)
           ================================================================= */}
        {tab === "launch" && (
          <div className="space-y-4">
            <div className="rounded-[20px] bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="ui-label">Contract Suite</p>
                  <p className="mt-1 text-[17px] font-extrabold tracking-tight text-ink">
                    ${(draft?.tokenSymbol ?? tokenSymbol) || "CANON"} · {vaultSharePct}/{teamSharePct} Fee Lock
                  </p>
                </div>
                {draft && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => {
                      persistDraft(null);
                      setError(null);
                    }}
                    className="min-h-[38px] cursor-pointer text-[12.5px] font-bold text-stone hover:text-ink"
                  >
                    Reset Draft
                  </button>
                )}
              </div>

              <div className="mt-4 space-y-1">
                {[
                  {
                    num: "01",
                    label: draft?.usedCustomAmm ? "$CANON Pool Engine" : "Launchpad Engine",
                    addr: draft?.launchpad,
                    kind: "address" as const,
                  },
                  {
                    num: "02",
                    label: "HYPE Pass Registry",
                    addr: draft?.passportRegistry,
                    kind: "address" as const,
                  },
                  {
                    num: "03",
                    label: "Fee Lock Factory",
                    addr: draft?.covenantFactory,
                    kind: "address" as const,
                  },
                  {
                    num: "04",
                    label: `$${(draft?.tokenSymbol ?? tokenSymbol) || "CANON"} Token`,
                    addr: draft?.pnth,
                    kind: "token" as const,
                  },
                  {
                    num: "05",
                    label: "Fee Lock Router",
                    addr: draft?.pnthRouter,
                    kind: "address" as const,
                  },
                  {
                    num: "06",
                    label: "Basket Registry",
                    addr: draft?.constituentRegistry,
                    kind: "address" as const,
                  },
                  {
                    num: "07",
                    label: "Staking Rewards",
                    addr: draft?.staking,
                    kind: "address" as const,
                  },
                  {
                    num: "08",
                    label: "Index Vault",
                    addr: draft?.indexVault,
                    kind: "address" as const,
                  },
                ].map((row) => (
                  <div
                    key={row.num}
                    className="flex items-center justify-between gap-3 py-3 text-[13.5px]"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="num text-[12px] font-bold text-stone-light">{row.num}.</span>
                      <span className="font-bold text-ink">{row.label}</span>
                    </div>
                    {row.addr ? (
                      <a
                        href={explorer(row.kind, row.addr)}
                        target="_blank"
                        rel="noreferrer"
                        className="num inline-flex items-center gap-1 font-bold text-forest hover:underline"
                      >
                        <CodeScramble value={short(row.addr)} />
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <span className="text-[12.5px] font-medium text-stone-light">Waiting</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2.5">
                {!launchComplete ? (
                  <button
                    type="button"
                    disabled={!onChain || !!busy}
                    onClick={handleLaunchSuite}
                    className="btn-signal w-full"
                  >
                    {busy ?? (draft?.launchpad ? "Resume $CANON Launch" : "Deploy Full $CANON Suite")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTab("seed")}
                    className="btn-primary w-full"
                  >
                    Suite Live · Open Seed & Basket →
                  </button>
                )}
              </div>

              <TxFeedback error={error} lastTx={lastTx} />
            </div>
          </div>
        )}

        {/* =================================================================
            STAGE 3: SEED (Swapper + Drip, 10-Coin Basket, Live App Switch)
           ================================================================= */}
        {tab === "seed" && (
          <div className="space-y-4">
            {/* Step A: Seed Liquidity + Free Drip */}
            <div className="rounded-[20px] bg-surface p-5">
              <p className="ui-label">01. Trade Helper & Free Token Drip</p>
              <p className="mt-1 text-[16px] font-extrabold tracking-tight text-ink">
                Seed 500 Test USDC & Fund 250 $CANON Drip
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-stone">
                Deploys your exact-input swapper, buys the first $CANON batch with free Test USDC, and stocks a one-tap faucet so testers can claim 250 $CANON.
              </p>

              {(draft?.swapper || draft?.drip) && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-stone">
                  {draft.swapper && <span className="num">Swapper {short(draft.swapper)}</span>}
                  {draft.swapper && draft.drip && <span aria-hidden="true">·</span>}
                  {draft.drip && <span className="num">Drip {short(draft.drip)}</span>}
                </div>
              )}

              <button
                type="button"
                disabled={!onChain || !targetDeployment || !!busy}
                onClick={handleSeedPoolAndDrip}
                className="btn-primary mt-4 w-full"
              >
                {busy && busy.includes("/5")
                  ? busy
                  : draft?.seededPool
                    ? "Buy More $CANON (500 Test USDC)"
                    : "Deploy Swapper, Buy $CANON & Fund Drip"}
              </button>
            </div>

            {/* Step B: Propose & Execute Clean 10-Coin Basket */}
            <div className="rounded-[20px] bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="ui-label">02. Top 10 Clean Basket</p>
                  <p className="mt-1 text-[16px] font-extrabold tracking-tight text-ink">
                    {activeBasketId > 0
                      ? `Round #${activeBasketId} Active on Chain`
                      : proposalCount > 0
                        ? `Proposal #${proposalCount} Queued`
                        : "Seed Round 4 Clean Coins"}
                  </p>
                </div>
                <span className="num text-[13px] font-bold text-stone">
                  10 coins · 100.00%
                </span>
              </div>

              <p className="mt-1.5 text-[13px] leading-relaxed text-stone">
                Queues PACT, DAWN, AK, REE, TROLOLO, QNCE, HAZL, ANGL, PRMR, and SRRL on your ConstituentRegistry. Proposals unlock after the 24-hour safety delay.
              </p>

              {proposalCount > 0 && !latestExecuted && latestEta > now && (
                <p className="num mt-3 pt-3 text-[13px] font-bold text-ink">
                  24h Timelock · Ready to execute in {until(latestEta - now)}
                </p>
              )}

              <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                <button
                  type="button"
                  disabled={!onChain || !targetDeployment || !!busy}
                  onClick={handleProposeBasket}
                  className="btn-secondary flex-1"
                >
                  {proposalCount > 0 ? "Propose Fresh Basket" : "Propose 10-Coin Basket"}
                </button>

                {proposalCount > 0 && !latestExecuted && (
                  <button
                    type="button"
                    disabled={!onChain || !canExecuteLatest || !!busy}
                    onClick={handleExecuteBasket}
                    className="btn-signal flex-1"
                  >
                    {canExecuteLatest
                      ? `Execute Proposal #${proposalCount}`
                      : `Unlocks in ${until(Math.max(0, latestEta - now))}`}
                  </button>
                )}
              </div>
            </div>

            {/* Step C: Manual Fee Route & Live App Switch */}
            <div className="rounded-[20px] bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="ui-label">03. Live App Switch & Fee Run</p>
                  <p className="mt-1 text-[16px] font-extrabold tracking-tight text-ink">
                    Vault Budget: <span className="num">{fmt(vaultUsdcRaw, 6)} USDC</span> · Runs:{" "}
                    <span className="num">{routerRuns}</span>
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!onChain || !targetDeployment || !!busy}
                  onClick={handleRunKeeperNow}
                  className="btn-secondary w-full"
                >
                  Route Fees & Run Vault Now
                </button>

                {targetDeployment && (
                  <button
                    type="button"
                    onClick={() =>
                      downloadTextFile(
                        "canon-elysium-testnet.json",
                        `${JSON.stringify(targetDeployment, null, 2)}\n`,
                      )
                    }
                    className="btn-secondary w-full"
                  >
                    <Download className="h-4 w-4" />
                    Export Config JSON
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-3.5">
                {customLive ? (
                  <>
                    <span className="text-[13px] font-bold text-forest">
                      App is wired to your custom $CANON
                    </span>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={handleResetToShared}
                      className="min-h-[38px] cursor-pointer text-[13px] font-bold text-stone hover:text-ink"
                    >
                      Switch to Shared Preview
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-[13px] text-stone">
                      Viewing shared Elysium preview contracts
                    </span>
                    {draft?.pnth && (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={handleActivateDraft}
                        className="min-h-[38px] cursor-pointer text-[13px] font-bold text-signal hover:underline"
                      >
                        Activate My $CANON →
                      </button>
                    )}
                  </>
                )}
              </div>

              <TxFeedback error={error} lastTx={lastTx} />
            </div>
          </div>
        )}

        {/* =================================================================
            STAGE 4: WORKERS (Zero-VPS Cloudflare Workers & GitHub Actions)
           ================================================================= */}
        {tab === "workers" && (
          <div className="space-y-4">
            {/* Live On-Chain & Worker Telemetry */}
            <div className="rounded-[20px] bg-surface p-5">
              <p className="ui-label">Live Worker Readout</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="canon-well p-3">
                  <p className="ui-label text-[10.5px]">Pass Worker</p>
                  <p className="mt-1 text-[14.5px] font-extrabold text-ink">
                    {workerStatus.data?.passportWorker.online
                      ? "Online"
                      : workerStatus.data?.passportWorker.configured
                        ? "Offline"
                        : "Not Linked"}
                  </p>
                </div>
                <div className="canon-well p-3">
                  <p className="ui-label text-[10.5px]">Fee Runs</p>
                  <p className="num mt-1 text-[14.5px] font-extrabold text-ink">
                    {workerStatus.data?.chain?.routerRuns ?? routerRuns}
                  </p>
                </div>
                <div className="canon-well p-3">
                  <p className="ui-label text-[10.5px]">Vault USDC</p>
                  <p className="num mt-1 text-[14.5px] font-extrabold text-ink">
                    {workerStatus.data?.chain
                      ? Number(workerStatus.data.chain.vaultUsdcBudget).toFixed(2)
                      : formatUnits(vaultUsdcRaw, 6)}
                  </p>
                </div>
                <div className="canon-well p-3">
                  <p className="ui-label text-[10.5px]">Active Round</p>
                  <p className="num mt-1 text-[14.5px] font-extrabold text-ink">
                    {workerStatus.data?.chain?.activeBasketId ?? activeBasketId}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-stone">
                Both background workers run on Cloudflare’s free plan ($0/month, no VPS). Once deployed, set{" "}
                <span className="num font-semibold text-ink">PASSPORT_API</span> to your Worker 1 URL.
              </p>
            </div>

            {/* Worker 1: HYPE Pass Minter */}
            <div className="rounded-[20px] bg-surface p-5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="ui-label">Worker 1 · Free Cloudflare Edge</p>
                  <p className="mt-0.5 text-[15.5px] font-extrabold tracking-tight text-ink">
                    HYPE Pass Minter (workers/passport-worker)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyText("w1-cmd", passportWorkerSnippet)}
                  className="btn-secondary min-h-[40px] px-3.5 text-[12.5px]"
                >
                  {copiedId === "w1-cmd" ? "Copied ✓" : "Copy Commands"}
                </button>
              </div>
              <pre className="num mt-3 overflow-x-auto rounded-[13px] bg-well p-3.5 text-[12px] leading-relaxed text-ink">
                {passportWorkerSnippet}
              </pre>
            </div>

            {/* Worker 2: 5-Minute Vault & Boost Keeper */}
            <div className="rounded-[20px] bg-surface p-5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="ui-label">Worker 2 · 5-Min Cron Trigger</p>
                  <p className="mt-0.5 text-[15.5px] font-extrabold tracking-tight text-ink">
                    Vault & Boost Keeper (workers/keeper-worker)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyText("w2-cmd", keeperWorkerSnippet)}
                  className="btn-secondary min-h-[40px] px-3.5 text-[12.5px]"
                >
                  {copiedId === "w2-cmd" ? "Copied ✓" : "Copy Commands"}
                </button>
              </div>
              <pre className="num mt-3 overflow-x-auto rounded-[13px] bg-well p-3.5 text-[12px] leading-relaxed text-ink">
                {keeperWorkerSnippet}
              </pre>
              <p className="mt-2.5 text-[12.5px] text-stone">
                Prefer GitHub instead? Push this repo and add{" "}
                <span className="num font-semibold text-ink">KEEPER_KEY</span> +{" "}
                <span className="num font-semibold text-ink">CANON_DEPLOYMENT_JSON</span> in GitHub Secrets—the included 5-minute workflow runs automatically.
              </p>
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
