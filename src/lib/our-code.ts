import rawAscendPoC from "@/data/AscendPoC.t.sol?raw";

// Live contract source rendered in CANON's code rain and contract ribbons.
export const OUR_CODE: string =
  rawAscendPoC || "contract CanonVault{constructor(IAscendLaunchpad lp,PoolId id){lp.acceptCreator(id);}}";

export async function readOurCode(): Promise<string> {
  return OUR_CODE;
}

/** Packed contract code (comments dropped, whitespace removed) for code spheres and vault rings. */
export function packCode(code: string): string {
  return code
    .slice(Math.max(0, code.indexOf("contract ")))
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("")
    .replace(/\s+/g, "");
}

export const PACKED_CODE: string = packCode(OUR_CODE);
