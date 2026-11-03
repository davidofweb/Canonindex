import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const ZIP_PATH = path.resolve("public/assets/aistudio/pantheon-main_f0d6565e.zip");
const OUT_FILE = path.resolve("src/lib/chain/testnet-artifacts.ts");

function readZipEntry(entryPath) {
  return execSync(`unzip -p "${ZIP_PATH}" "pantheon-main/${entryPath}"`, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

// List all .sol files inside pantheon-main/src and pantheon-main/lib
const listing = execSync(`unzip -Z1 "${ZIP_PATH}"`, { encoding: "utf8" })
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("pantheon-main/") && l.endsWith(".sol"));

const zipFiles = new Map();
for (const full of listing) {
  const rel = full.slice("pantheon-main/".length);
  zipFiles.set(rel, full);
}

const CANON_TESTNET_HELPERS_SOL = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAscendLaunchpad} from "ascend/interfaces/IAscendLaunchpad.sol";
import {AscendToken} from "ascend/AscendToken.sol";
import {LaunchpadKey} from "ascend/libraries/LaunchpadKey.sol";
import {FullMath} from "ascend/vendor/v4-math/FullMath.sol";
import {PoolId, PoolIdLibrary} from "infinity-core/src/types/PoolId.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "infinity-core/src/types/BalanceDelta.sol";
import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {ILockCallback} from "infinity-core/src/interfaces/ILockCallback.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {TickMath} from "infinity-core/src/pool-cl/libraries/TickMath.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";

/// @title CanonTestnetAmm
/// @notice Open Elysium Testnet launchpad and constant-product pool for $CANON when Ascend's shared
/// testnet launchpad has new launches paused ahead of mainnet. Preserves exact PoolKey/PoolId math,
/// 1% trade fee (0.50% to CovenantRouter creator legs), and Q96 sqrtPrice quotes.
contract CanonTestnetAmm {
    using PoolIdLibrary for PoolKey;
    using SafeTransferLib for ERC20;

    uint256 public constant INITIAL_SUPPLY = 1_000_000_000e18;
    uint256 public constant VIRTUAL_QUOTE = 30_000e6;
    uint256 public constant FEE_BPS = 100; // 1.00% total trade fee
    uint256 public constant CREATOR_FEE_BPS = 50; // 0.50% creator fee routed to CovenantRouter

    address public immutable baseQuote;
    bool public constant paused = false;

    struct PoolState {
        address token;
        address quote;
        address creator;
        bool tokenIs0;
        uint40 launchedAt;
        uint40 emaUpdatedAt;
        uint160 emaSqrtPriceX96;
        uint256 tokenReserve;
        uint256 realQuoteReserve;
    }

    mapping(PoolId => PoolState) internal _pools;
    mapping(PoolId => address) public pendingCreator;
    mapping(PoolId => uint256) public creatorOwedToken;
    mapping(PoolId => uint256) public creatorOwedQuote;

    error UnknownPool();
    error NotCreator();
    error NotPendingCreator();
    error InsufficientOutput();

    constructor(address baseQuote_) {
        baseQuote = baseQuote_;
    }

    function poolManager() external view returns (address) {
        return address(this);
    }

    function vault() external view returns (address) {
        return address(this);
    }

    function launch(IAscendLaunchpad.LaunchParams calldata p)
        external
        returns (address tokenAddr, PoolId poolId)
    {
        AscendToken tok = new AscendToken{salt: keccak256(abi.encode(msg.sender, p.salt))}(
            p.name,
            p.symbol,
            INITIAL_SUPPLY
        );
        tokenAddr = address(tok);

        PoolKey memory key = LaunchpadKey.keyOf(tokenAddr, p.quote, address(this), address(this));
        poolId = key.toId();

        bool tokenIs0 = tokenAddr < p.quote;
        uint160 sqrtP = _computeSqrtPriceX96(INITIAL_SUPPLY, VIRTUAL_QUOTE, tokenIs0);
        uint40 nowTs = uint40(block.timestamp);

        _pools[poolId] = PoolState({
            token: tokenAddr,
            quote: p.quote,
            creator: p.creator,
            tokenIs0: tokenIs0,
            launchedAt: nowTs,
            emaUpdatedAt: nowTs,
            emaSqrtPriceX96: sqrtP,
            tokenReserve: INITIAL_SUPPLY,
            realQuoteReserve: 0
        });
    }

    function swapExactIn(
        PoolKey calldata key,
        bool zeroForOne,
        uint256 amountIn,
        address to
    ) external returns (uint256 out) {
        PoolId id = key.toId();
        PoolState storage s = _pools[id];
        if (s.launchedAt == 0) revert UnknownPool();

        bool buyingToken = zeroForOne ? !s.tokenIs0 : s.tokenIs0;

        if (buyingToken) {
            ERC20(s.quote).safeTransferFrom(msg.sender, address(this), amountIn);
            uint256 totalFee = (amountIn * FEE_BPS) / 10_000;
            uint256 creatorFee = (amountIn * CREATOR_FEE_BPS) / 10_000;
            uint256 netIn = amountIn - totalFee;

            uint256 effQuote = VIRTUAL_QUOTE + s.realQuoteReserve;
            out = FullMath.mulDiv(s.tokenReserve, netIn, effQuote + netIn);
            if (out == 0 || out >= s.tokenReserve) revert InsufficientOutput();

            s.tokenReserve -= out;
            s.realQuoteReserve += (amountIn - creatorFee);
            creatorOwedQuote[id] += creatorFee;

            s.emaSqrtPriceX96 = _computeSqrtPriceX96(
                s.tokenReserve,
                VIRTUAL_QUOTE + s.realQuoteReserve,
                s.tokenIs0
            );
            s.emaUpdatedAt = uint40(block.timestamp);

            ERC20(s.token).safeTransfer(to, out);
        } else {
            ERC20(s.token).safeTransferFrom(msg.sender, address(this), amountIn);
            uint256 totalFee = (amountIn * FEE_BPS) / 10_000;
            uint256 creatorFee = (amountIn * CREATOR_FEE_BPS) / 10_000;
            uint256 netIn = amountIn - totalFee;

            uint256 effQuote = VIRTUAL_QUOTE + s.realQuoteReserve;
            out = FullMath.mulDiv(effQuote, netIn, s.tokenReserve + netIn);
            if (out > s.realQuoteReserve) {
                out = s.realQuoteReserve;
            }
            if (out == 0) revert InsufficientOutput();

            s.tokenReserve += (amountIn - creatorFee);
            s.realQuoteReserve -= out;
            creatorOwedToken[id] += creatorFee;

            s.emaSqrtPriceX96 = _computeSqrtPriceX96(
                s.tokenReserve,
                VIRTUAL_QUOTE + s.realQuoteReserve,
                s.tokenIs0
            );
            s.emaUpdatedAt = uint40(block.timestamp);

            ERC20(s.quote).safeTransfer(to, out);
        }
    }

    function collect(PoolId) external pure returns (uint256) {
        return 0;
    }

    function claim(PoolId id) external {
        _claimToken(id);
        _claimQuote(id);
    }

    function claimToken(PoolId id) external {
        _claimToken(id);
    }

    function claimQuote(PoolId id) external {
        _claimQuote(id);
    }

    function transferCreator(PoolId id, address next) external {
        if (_pools[id].creator != msg.sender) revert NotCreator();
        pendingCreator[id] = next;
    }

    function acceptCreator(PoolId id) external {
        if (pendingCreator[id] != msg.sender) revert NotPendingCreator();
        _pools[id].creator = msg.sender;
        delete pendingCreator[id];
    }

    function poolCreator(PoolId id) external view returns (address) {
        return _pools[id].creator;
    }

    function emaSqrtPrice(PoolId id) external view returns (uint160) {
        return _pools[id].emaSqrtPriceX96;
    }

    function emaUpdatedAt(PoolId id) external view returns (uint40) {
        return _pools[id].emaUpdatedAt;
    }

    function poolLaunchedAt(PoolId id) external view returns (uint40) {
        return _pools[id].launchedAt;
    }

    function poolTokenIs0(PoolId id) external view returns (bool) {
        return _pools[id].tokenIs0;
    }

    function _claimToken(PoolId id) internal {
        PoolState storage s = _pools[id];
        uint256 amt = creatorOwedToken[id];
        if (amt > 0 && s.creator != address(0)) {
            creatorOwedToken[id] = 0;
            ERC20(s.token).safeTransfer(s.creator, amt);
        }
    }

    function _claimQuote(PoolId id) internal {
        PoolState storage s = _pools[id];
        uint256 amt = creatorOwedQuote[id];
        if (amt > 0 && s.creator != address(0)) {
            creatorOwedQuote[id] = 0;
            ERC20(s.quote).safeTransfer(s.creator, amt);
        }
    }

    function _computeSqrtPriceX96(
        uint256 tokenRes,
        uint256 quoteRes,
        bool tokenIs0
    ) internal pure returns (uint160) {
        (uint256 res0, uint256 res1) = tokenIs0 ? (tokenRes, quoteRes) : (quoteRes, tokenRes);
        uint256 scaled = FullMath.mulDiv(res1, uint256(1) << 128, res0);
        uint256 root = _sqrt(scaled) << 32;
        return uint160(root);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        uint256 y = x;
        z = 1;
        if (y >= 0x100000000000000000000000000000000) { y >>= 128; z <<= 64; }
        if (y >= 0x10000000000000000) { y >>= 64; z <<= 32; }
        if (y >= 0x100000000) { y >>= 32; z <<= 16; }
        if (y >= 0x10000) { y >>= 16; z <<= 8; }
        if (y >= 0x100) { y >>= 8; z <<= 4; }
        if (y >= 0x10) { y >>= 4; z <<= 2; }
        if (y >= 0x8) { z <<= 1; }
        for (uint256 i = 0; i < 7; ++i) {
            z = (z + x / z) >> 1;
        }
        uint256 z1 = x / z;
        return z < z1 ? z : z1;
    }
}

interface ICanonAmmSwap {
    function swapExactIn(
        PoolKey calldata key,
        bool zeroForOne,
        uint256 amountIn,
        address to
    ) external returns (uint256 out);
}

/// @title CanonSwapper
/// @notice Exact-input swap helper compatible with both Ascend Infinity pools and CanonTestnetAmm pools.
contract CanonSwapper is ILockCallback {
    using BalanceDeltaLibrary for BalanceDelta;
    using SafeTransferLib for ERC20;

    IVault public immutable vault;
    ICLPoolManager public immutable pm;

    constructor(IVault v, ICLPoolManager p) {
        vault = v;
        pm = p;
    }

    function swapExactIn(
        PoolKey memory key,
        bool zeroForOne,
        uint256 amountIn
    ) external returns (uint256 out) {
        Currency cin = zeroForOne ? key.currency0 : key.currency1;
        ERC20 tokenIn = ERC20(Currency.unwrap(cin));
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);

        if (address(key.poolManager) != address(pm) && address(key.hooks) == address(key.poolManager)) {
            tokenIn.safeApprove(address(key.hooks), amountIn);
            out = ICanonAmmSwap(address(key.hooks)).swapExactIn(key, zeroForOne, amountIn, msg.sender);
            tokenIn.safeApprove(address(key.hooks), 0);
            return out;
        }

        out = abi.decode(vault.lock(abi.encode(key, zeroForOne, amountIn, msg.sender)), (uint256));
    }

    function lockAcquired(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(vault), "only vault");
        (PoolKey memory key, bool zeroForOne, uint256 amountIn, address to) =
            abi.decode(data, (PoolKey, bool, uint256, address));
        BalanceDelta d = pm.swap(
            key,
            ICLPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1
            }),
            ""
        );
        (Currency cin, Currency cout) = zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        int128 inD = zeroForOne ? d.amount0() : d.amount1();
        int128 outD = zeroForOne ? d.amount1() : d.amount0();
        if (inD < 0) {
            vault.sync(cin);
            ERC20(Currency.unwrap(cin)).safeTransfer(address(vault), uint256(uint128(-inD)));
            vault.settle();
        }
        uint256 out = outD > 0 ? uint256(uint128(outD)) : 0;
        if (out > 0) vault.take(cout, to, out);
        return abi.encode(out);
    }
}
`;

const ROOT_SOURCES = [
  "src/passport/HypePassportRegistry.sol",
  "src/covenant/CovenantFactory.sol",
  "src/index/ConstituentRegistry.sol",
  "src/staking/PantheonStaking.sol",
  "src/index/IndexVault.sol",
  "src/testnet/TestDrip.sol",
  "src/testnet/CanonTestnetHelpers.sol",
];

const sources = {};
for (const s of ROOT_SOURCES) {
  if (s === "src/testnet/CanonTestnetHelpers.sol") {
    sources[s] = { content: CANON_TESTNET_HELPERS_SOL };
  } else {
    sources[s] = { content: readZipEntry(s) };
  }
}

const REMAPPINGS = [
  ["ascend/", "lib/ascend/src/"],
  ["infinity-core/", "lib/ascend/lib/infinity-core/"],
  ["@openzeppelin/contracts/", "lib/ascend/lib/openzeppelin-contracts/contracts/"],
  ["openzeppelin-contracts/", "lib/ascend/lib/openzeppelin-contracts/"],
  ["solmate/", "lib/ascend/lib/solmate/"],
];

function findImports(importPath) {
  let candidate = importPath;
  for (const [prefix, target] of REMAPPINGS) {
    if (candidate.startsWith(prefix)) {
      candidate = target + candidate.slice(prefix.length);
      break;
    }
  }
  const tries = [
    candidate,
    `lib/ascend/${candidate}`,
    `lib/ascend/lib/${candidate}`,
  ];
  for (const t of tries) {
    const clean = path.posix.normalize(t);
    if (zipFiles.has(clean)) {
      return { contents: readZipEntry(clean) };
    }
  }
  return { error: `File not found: ${importPath} (tried ${candidate})` };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    evmVersion: "cancun",
    remappings: REMAPPINGS.map(([a, b]) => `${a}=${b}`),
    optimizer: { enabled: true, runs: 200 },
    metadata: { bytecodeHash: "none" },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
  },
};

console.log(`Compiling with solc ${solc.version()}...`);
const rawOut = solc.compile(JSON.stringify(input), { import: findImports });
const output = JSON.parse(rawOut);

const errors = (output.errors || []).filter((e) => e.severity === "error");
if (errors.length > 0) {
  console.error("Compilation errors:");
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}

const TARGETS = [
  ["hypePassportRegistry", "src/passport/HypePassportRegistry.sol", "HypePassportRegistry"],
  ["covenantFactory", "src/covenant/CovenantFactory.sol", "CovenantFactory"],
  ["constituentRegistry", "src/index/ConstituentRegistry.sol", "ConstituentRegistry"],
  ["pantheonStaking", "src/staking/PantheonStaking.sol", "PantheonStaking"],
  ["indexVault", "src/index/IndexVault.sol", "IndexVault"],
  ["testDrip", "src/testnet/TestDrip.sol", "TestDrip"],
  ["canonTestnetAmm", "src/testnet/CanonTestnetHelpers.sol", "CanonTestnetAmm"],
  ["canonSwapper", "src/testnet/CanonTestnetHelpers.sol", "CanonSwapper"],
];

const lines = [
  "// Auto-generated from Solidity 0.8.30 (cancun, optimizer 200 runs, bytecodeHash none).",
  "// Contains verified creation bytecode and ABIs for independent $CANON testnet launches.",
  "",
  "export type ContractArtifact = {",
  "  readonly abi: readonly Record<string, unknown>[];",
  "  readonly bytecode: `0x${string}`;",
  "};",
  "",
];

for (const [exportKey, fileKey, contractName] of TARGETS) {
  const c = output.contracts?.[fileKey]?.[contractName];
  if (!c || !c.evm?.bytecode?.object) {
    throw new Error(`Missing compiled bytecode for ${contractName}`);
  }
  const bytecode = `0x${c.evm.bytecode.object}`;
  console.log(`  ✓ ${contractName.padEnd(22)} ${(bytecode.length - 2) / 2} bytes`);
  lines.push(
    `export const ${exportKey}Artifact = {`,
    `  abi: ${JSON.stringify(c.abi)} as const,`,
    `  bytecode: "${bytecode}" as \`0x\${string}\`,`,
    "} as const;",
    "",
  );
}

fs.writeFileSync(OUT_FILE, lines.join("\n"), "utf8");
console.log(`Wrote ${OUT_FILE}`);
